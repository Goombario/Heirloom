import type { GedcomClient, GedcomDryRunResponse, GedcomImportResponse, SpreadsheetDryRunResponse, SpreadsheetImportResponse, MediaImportMaterializationOutcome, ExportArtifact, GedcomExportOptions, MediaExportPreflight } from '../types';
import { asStorageLimitError, NotFoundError } from '../errors';
import { ensureLocalUser } from '../local-user';
import { getClient } from '@/lib/db/connection';
import { downscaleToThumb, processForUpload } from '@/lib/media/process-image';
import { assertBrowserStorageCapacity } from '@/lib/media/storage-capacity';
import { captureFacesForMedia } from '@/lib/services/media-face-capture';
import { normalizeArchivePath } from '@/lib/gedcom/media-match';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import {
  findReusableImportMedia, findReusableImportMediaByBlob, getMediaImportItem, lockMediaImportItem, reuseMediaForImportItem, transitionMediaImportItem,
} from '@/lib/db/queries/media-import-items';
import { patchMediaFile } from '@/lib/db/queries/media';
import { clearPrimaryMediaLinksForMedia } from '@/lib/db/queries/media-links';
import { safeRollback } from '@/lib/db/rollback';
import { AccessError } from '../errors';
import { ValidationError } from '@/lib/validation';
import { ALLOWED_EXTENSIONS, classifyUpload, fileExtension } from '@/lib/media/allowed-extensions';
import { processPdfForUpload } from '@/lib/media/process-document';
import { hashBytes } from '@/lib/media/content-hash';
import {
  listUnresolvedImportMediaService,
  markImportMediaMissingService,
  removeUnresolvedImportMediaService,
  removeUnresolvedImportMediaBatchService,
  recordImportMediaFailureService,
  reusedOutcome,
} from '@/lib/services/media-import-items';
import {
  previewGedcomService,
  importGedcomService,
  previewSpreadsheetService,
  importSpreadsheetService,
  resetService,
} from '@/lib/services/gedcom';
import { exportGedcomLocalService, localExportArtifact } from './gedcom-export';
import type { GedcomImportStep } from '@/lib/gedcom/import-steps';

/**
 * GEDCOM/import methods backed by in-browser PGlite.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree).
 */
export class LocalGedcomClient implements GedcomClient {
  async preflightExport(treeId?: number | null): Promise<MediaExportPreflight> {
    const currentUserId = await ensureLocalUser();
    const result = await exportGedcomLocalService({
      requestedTreeId: treeId ?? null,
      currentUserId,
      includeMedia: true,
      preflightOnly: true,
    });
    if (result.kind !== 'preflight') throw new Error('Unexpected local export preflight result');
    return result.preflight;
  }

  async exportGedcom(options: GedcomExportOptions = {}, treeId?: number | null): Promise<ExportArtifact> {
    const currentUserId = await ensureLocalUser();
    const result = await exportGedcomLocalService({
      requestedTreeId: treeId ?? null,
      currentUserId,
      includeMedia: options.includeMedia === true,
      mediaPolicy: options.mediaPolicy,
    });
    if (result.kind === 'blocked') {
      throw new Error(`Media export blocked: ${JSON.stringify(result.preflight)}`);
    }
    if (result.kind === 'preflight') throw new Error('Unexpected local export preflight result');
    return localExportArtifact(result);
  }

  /** Parse a GEDCOM file and return a preview of what would be imported. */
  async previewGedcom(
    input: { file: File; mode: 'overwrite' | 'merge'; mediaJson?: string | null; sourcesJson?: string | null },
    // Preview is a pure parse — no tree scope needed (kept for interface arity).
    _treeId?: number | null
  ): Promise<GedcomDryRunResponse> {
    const currentUserId = await ensureLocalUser();
    return previewGedcomService({
      file: input.file,
      mode: input.mode,
      mediaJson: input.mediaJson,
      sourcesJson: input.sourcesJson,
      currentUserId,
    });
  }

  /** Parse a GEDCOM file and import its data into the local PGlite DB. */
  async importGedcom(
    input: { file: File; mode: 'overwrite' | 'merge'; casesJson?: string | null; mediaJson?: string | null; sourcesJson?: string | null; placesJson?: string | null; archiveManifest?: string[]; onProgress?: (step: GedcomImportStep) => void },
    treeId?: number | null
  ): Promise<GedcomImportResponse> {
    const currentUserId = await ensureLocalUser();
    return importGedcomService({
      file: input.file,
      mode: input.mode,
      casesJson: input.casesJson,
      mediaJson: input.mediaJson,
      sourcesJson: input.sourcesJson,
      placesJson: input.placesJson,
      archiveManifest: input.archiveManifest,
      currentUserId,
      requestedTreeId: treeId ?? null,
      requestedOwnerId: null,
      onProgress: input.onProgress,
    });
  }

  async listUnresolvedImportMedia(treeId?: number | null) {
    const currentUserId = await ensureLocalUser();
    return listUnresolvedImportMediaService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async markImportMediaMissing(itemIds: number[], treeId?: number | null) {
    const currentUserId = await ensureLocalUser();
    return markImportMediaMissingService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, itemIds });
  }

  async materializeImportMedia(itemId: number, archivePath: string, file: File, treeId?: number | null): Promise<MediaImportMaterializationOutcome> {
    const currentUserId = await ensureLocalUser();
    if (!Number.isInteger(itemId) || itemId <= 0) throw new ValidationError('Invalid media import item ID');
    if (!file) throw new ValidationError('No file uploaded');
    const requestedPath = normalizeArchivePath(archivePath);
    if (!requestedPath) throw new ValidationError('archivePath must be a safe, non-empty path');
    const scope = await resolveTreeScope({ treeId: treeId ?? null, ownerId: null }, currentUserId);
    if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');
    const first = await getMediaImportItem(itemId, scope.treeId);
    if (!first) throw new NotFoundError('Media import item not found');
    if (first.status === 'ready') return { outcome: 'already_ready', item: first, failureCode: null, retryable: false };
    if (normalizeArchivePath(first.archivePath) !== requestedPath) {
      const failed = await recordImportMediaFailureService({ itemId, treeId: scope.treeId, failureCode: 'archive_path_mismatch' });
      return { outcome: 'failed', item: failed, failureCode: 'archive_path_mismatch', retryable: true };
    }

    const kind = classifyUpload(file.name, file.type);
    if (!ALLOWED_EXTENSIONS.has(fileExtension(file.name)) || !kind) {
      const failed = await recordImportMediaFailureService({ itemId, treeId: scope.treeId, failureCode: 'unsupported_media_type' });
      return { outcome: 'failed', item: failed, failureCode: 'unsupported_media_type', retryable: true };
    }

    let processed: Awaited<ReturnType<typeof processForUpload>>;
    let rawBytes: Uint8Array;
    let contentHash: string;
    try {
      await assertBrowserStorageCapacity(file.size);
      processed = kind === 'pdf' ? await processPdfForUpload(file) : await processForUpload(file);
      rawBytes = new Uint8Array(await file.arrayBuffer());
      contentHash = await hashBytes(rawBytes);
    } catch (error) {
      const failureCode = asStorageLimitError(error) ? 'storage_capacity'
        : error instanceof ValidationError ? 'unsupported_media_type' : 'decode_failed';
      const failed = await recordImportMediaFailureService({ itemId, treeId: scope.treeId, failureCode });
      return { outcome: 'failed', item: failed, failureCode, retryable: true };
    }

    // Decode the derived asset before opening the PGlite transaction. The
    // materialization lock must not expose a `ready` item until this work has
    // completed; SVG/GIF and decode failures deliberately leave this null so
    // the durable full blob remains the browse fallback.
    let thumbnail: Awaited<ReturnType<typeof downscaleToThumb>> = null;
    try {
      thumbnail = await downscaleToThumb(processed.bytes, processed.contentType, 256);
    } catch { /* the original bytes remain valid even when derivation fails */ }

    const client = await getClient();
    let failureCode: 'storage_capacity' | 'materialization_failed' = 'materialization_failed';
    let readyItem: Awaited<ReturnType<typeof lockMediaImportItem>> = null;
    try {
      await client.query('BEGIN');
      const locked = await lockMediaImportItem(itemId, scope.treeId, client);
      if (!locked) throw new NotFoundError('Media import item not found');
      if (locked.status === 'ready') {
        await client.query('COMMIT');
        return { outcome: 'already_ready', item: locked, failureCode: null, retryable: false };
      }
      // The same bytes are already in this tree: link that photo instead of
      // storing a second copy (#858). An exported photo carries its stored
      // bytes, not the original upload, so compare those as well (#952).
      const reusable = await findReusableImportMedia(scope.treeId, locked.mediaId, contentHash, client)
        ?? await findReusableImportMediaByBlob(scope.treeId, locked.mediaId, rawBytes, client);
      if (reusable !== null) {
        await reuseMediaForImportItem(locked.mediaId, reusable, scope.treeId, client);
        await client.query('COMMIT');
        return reusedOutcome(locked, reusable);
      }
      await client.query(
        `INSERT INTO "MediaBlob" ("MediaId", "Data") VALUES ($1, $2)
         ON CONFLICT ("MediaId") DO UPDATE SET "Data" = EXCLUDED."Data"`,
        [locked.mediaId, processed.bytes],
      );
      await patchMediaFile(locked.mediaId, scope.treeId, {
        FilePath: null, ContentType: processed.contentType, Format: processed.format,
        FileSize: processed.bytes.length, ContentHash: contentHash,
      }, client);
      // A GEDCOM `_PRIM` can name any multimedia record; a PDF never becomes a portrait.
      if (kind === 'pdf') await clearPrimaryMediaLinksForMedia(locked.mediaId, client);
      if (thumbnail) {
        // A thumbnail is an optimization, not a reason to lose the original.
        // Isolate its write so a quota failure still allows the blob + ready
        // state to commit and the reader to fall back to MediaBlob.
        await client.query('SAVEPOINT media_import_thumbnail');
        try {
          await client.query(
            `INSERT INTO "MediaThumb" ("MediaId", "Data") VALUES ($1, $2)
             ON CONFLICT ("MediaId") DO UPDATE SET "Data" = EXCLUDED."Data"`,
            [locked.mediaId, thumbnail.bytes],
          );
          await client.query('RELEASE SAVEPOINT media_import_thumbnail');
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT media_import_thumbnail');
          await client.query('RELEASE SAVEPOINT media_import_thumbnail');
        }
      }
      const ready = await transitionMediaImportItem(itemId, scope.treeId, 'ready', null, client);
      if (!ready) throw new NotFoundError('Media import item not found');
      await client.query('COMMIT');
      readyItem = ready;
    } catch (error) {
      await safeRollback(client);
      if (error instanceof NotFoundError) throw error;
      if (asStorageLimitError(error)) failureCode = 'storage_capacity';
    } finally {
      client.release();
    }
    if (!readyItem) {
      const failed = await recordImportMediaFailureService({ itemId, treeId: scope.treeId, failureCode });
      return { outcome: 'failed', item: failed, failureCode, retryable: true };
    }
    if (kind === 'pdf') return { outcome: 'ready', item: readyItem, failureCode: null, retryable: false };
    try {
      await captureFacesForMedia(rawBytes, readyItem.mediaId, scope.treeId, { skipIfTagged: readyItem.skipFaceCapture });
    } catch { /* enrichment never downgrades ready */ }
    return { outcome: 'ready', item: readyItem, failureCode: null, retryable: false };
  }

  async removeUnresolvedImportMedia(itemId: number, treeId?: number | null): Promise<void> {
    const currentUserId = await ensureLocalUser();
    return removeUnresolvedImportMediaService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, itemId });
  }

  async removeUnresolvedImportMediaBatch(itemIds: number[], treeId?: number | null): Promise<number[]> {
    const currentUserId = await ensureLocalUser();
    return removeUnresolvedImportMediaBatchService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, itemIds });
  }

  /** Parse a spreadsheet file and return a preview of what would be imported. */
  async previewSpreadsheet(
    file: File,
    dateFormat: 'MDY' | 'DMY',
    treeId?: number | null
  ): Promise<SpreadsheetDryRunResponse> {
    const currentUserId = await ensureLocalUser();
    return previewSpreadsheetService({ file, dateFormat, currentUserId, requestedTreeId: treeId ?? null, requestedOwnerId: null });
  }

  /** Parse a spreadsheet file and import its data into the local PGlite DB. */
  async importSpreadsheet(
    file: File,
    dateFormat: 'MDY' | 'DMY',
    treeId?: number | null
  ): Promise<SpreadsheetImportResponse> {
    const currentUserId = await ensureLocalUser();
    return importSpreadsheetService({ file, dateFormat, currentUserId, requestedTreeId: treeId ?? null, requestedOwnerId: null });
  }

  /** Delete all genealogy data for the local user. */
  async reset(): Promise<{ success: true; message: string }> {
    const currentUserId = await ensureLocalUser();
    return resetService({ currentUserId });
  }
}
