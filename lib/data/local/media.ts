import type { Audited, MediaClient, ListMediaOptions, UploadMediaInput, UpdateMediaInput, CreateMediaTagInput, UpdateMediaTagInput, FaceConfirmBatchResult, FaceGroup, DuplicateMatch, MediaDeleteBatchResult, MediaStorageSummary } from '../types';
import type { Media, MediaLinkOwner, MediaTag, MediaTagWithPerson, FaceDismissReason, OwnerGalleryMedia } from '@/lib/db/schema';
import type { LinkOwnerTable, MediaOwnerFact, MediaOwnerTable } from '@/lib/db/fact-tables';
import type { FaceSuggestionSnapshot } from '@/lib/db/queries/media-faces';
import { asStorageLimitError, NotFoundError } from '../errors';
import { ValidationError } from '@/lib/validation';
import { ensureLocalUser } from '../local-user';
import { getClient, query } from '@/lib/db/connection';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { safeRollback } from '@/lib/db/rollback';
import { resolveMediaUploadTargets, uploadLinks } from '@/lib/services/media-upload-targets';
import { processForUpload, downscaleToThumb } from '@/lib/media/process-image';
import { processPdfForUpload } from '@/lib/media/process-document';
import { assertBrowserStorageCapacity } from '@/lib/media/storage-capacity';
import { ALLOWED_EXTENSIONS, classifyUpload, fileExtension } from '@/lib/media/allowed-extensions';
import { hashBytes } from '@/lib/media/content-hash';
import { getMediaBlobsByIds, getMediaByUploadIntent, getMediaThumbStatesByIds, patchMediaDateIfUnset, patchMediaTitle, type MediaThumbState } from '@/lib/db/queries/media';
import { createCanonicalMedia, listMediaService, updateMediaService, setPrimaryMediaService, clearPrimaryMediaService, setFamilyPhotoService, clearFamilyPhotoService, listTagsService, createTagService, updateTagService, removeTagService, deleteMediaService, deleteMediaBatchService } from '@/lib/services/media';
import { getMediaStorageSummaryService } from '@/lib/services/media-storage';
import { findDuplicatesService } from '@/lib/services/media-duplicates';
import { listGalleryForOwnerService, listLinkOwnersForMediaService, listMediaForOwnerService, unlinkMediaForOwnerService, linkMediaForOwnerService } from '@/lib/services/media-links';
import {
  listFaceQueueService, confirmFacesService, repointFacesService,
  dismissFacesService, undoFacesService, restoreFaceSuggestionsService,
} from '@/lib/services/media-faces';
import { captureFacesForMedia } from '@/lib/services/media-face-capture';
import { serializeUploadIntentTarget, verifyUploadIntentIdentity } from '@/lib/services/media-upload-intent';
import { isUniqueViolation, validateUploadIntentId } from '@/lib/media/upload-intent';

// No per-file size cap here. This client backs the static (Cloudflare/PGlite) and
// Tauri desktop builds — src-tauri/tauri.conf.json runs build:static, so they are
// one build — where the storage is the user's own IndexedDB, not a shared service.
// The real ceiling is the browser's storage quota, which surfaces as the 507 that
// lib/data/errors.ts already models, rather than a number invented here (#489).

// A photo grid mounts every tile at once, and each tile asks for its thumbnail.
// One PGlite query per tile cost 2–3× a single batched read on a cold load, and
// more in WebKitGTK (#1160): every query is a dozen worker round trips. Requests
// made in the same task are collected and read per tree in chunks; a chunk keeps
// one result set to a bounded size.
const THUMB_BATCH_SIZE = 50;
// Full files are read the same way when a tile has no thumbnail (#1266). Each
// original in a chunk is in memory at once, so its chunks stay small.
const BLOB_BATCH_SIZE = 8;

type BatchRequest<V> = { id: number; resolve: (value: V | undefined) => void; reject: (err: unknown) => void };

/**
 * Collects reads made in the same task and runs them per tree, `size` ids per
 * query. Resolves `undefined` for an id the read didn't return.
 */
function treeBatcher<V>(size: number, read: (ids: number[], treeId: number) => Promise<Map<number, V>>) {
  const pending = new Map<number, BatchRequest<V>[]>();
  let scheduled = false;

  async function flush(): Promise<void> {
    scheduled = false;
    const batches = [...pending];
    pending.clear();
    for (const [treeId, requests] of batches) {
      for (let start = 0; start < requests.length; start += size) {
        const chunk = requests.slice(start, start + size);
        try {
          const values = await read([...new Set(chunk.map((r) => r.id))], treeId);
          for (const request of chunk) request.resolve(values.get(request.id));
        } catch (err) {
          for (const request of chunk) request.reject(err);
        }
      }
    }
  }

  return (id: number, treeId: number): Promise<V | undefined> => new Promise((resolve, reject) => {
    const requests = pending.get(treeId) ?? [];
    requests.push({ id, resolve, reject });
    pending.set(treeId, requests);
    if (!scheduled) {
      scheduled = true;
      // A macrotask, not a microtask: each caller first awaits the local user and
      // default tree, so same-render requests arrive over several microtask turns.
      setTimeout(() => void flush(), 0);
    }
  });
}

/** Stored thumbnail and file presence for `id` in `treeId`; undefined when it isn't in the tree. */
const readThumbState = treeBatcher<MediaThumbState>(THUMB_BATCH_SIZE, getMediaThumbStatesByIds);
/** Full file bytes for `id` in `treeId`; undefined when there is no file. */
const readBlob = treeBatcher(BLOB_BATCH_SIZE, getMediaBlobsByIds);

// A tile whose thumbnail read found no file at all asks for the full file next
// (MediaImg's fallback). The thumbnail read already answered that, so the
// answer is kept briefly and used once, rather than read again per tile. A file
// attached later is read normally: the note expires, and a retry has none.
const NO_BLOB_NOTE_MS = 5_000;
const noBlobNotes = new Map<string, number>();

function noteNoBlob(id: number, treeId: number): void {
  const now = Date.now();
  for (const [key, expires] of noBlobNotes) if (expires <= now) noBlobNotes.delete(key);
  noBlobNotes.set(`${treeId}:${id}`, now + NO_BLOB_NOTE_MS);
}

function takeNoBlobNote(id: number, treeId: number): boolean {
  const key = `${treeId}:${id}`;
  const expires = noBlobNotes.get(key);
  if (expires === undefined) return false;
  noBlobNotes.delete(key);
  return expires > Date.now();
}

// A miss reads the full image and downscales it on a canvas. The first visit after
// an import misses on every tile at once; run together, all the full reads queued
// ahead of every thumbnail write, so even the first screen waited for the whole
// grid, with every original in memory. A few at a time, oldest request first, fills
// the grid from the top.
const THUMB_GENERATION_SLOTS = 4;
let thumbGenerationsRunning = 0;
const thumbGenerationQueue: Array<() => void> = [];

async function withThumbGenerationSlot<T>(generate: () => Promise<T>): Promise<T> {
  while (thumbGenerationsRunning >= THUMB_GENERATION_SLOTS) {
    await new Promise<void>((resolve) => thumbGenerationQueue.push(resolve));
  }
  thumbGenerationsRunning++;
  try {
    return await generate();
  } finally {
    thumbGenerationsRunning--;
    thumbGenerationQueue.shift()?.();
  }
}

/** Media backed by in-browser PGlite (bytes in MediaBlob, canvas processing). */
export class LocalMediaClient implements MediaClient {
  async list<T extends Media = Media>(options: ListMediaOptions = {}): Promise<{ media: T[]; count: number }> {
    const currentUserId = await ensureLocalUser();
    const media = await listMediaService({
      requestedTreeId: options.treeId ?? null, requestedOwnerId: null, currentUserId,
      personId: options.personId, withPerson: options.withPerson, includeTagged: options.includeTagged,
    });
    return { media: media as unknown as T[], count: media.length };
  }

  async getStorageSummary(treeId?: number | null): Promise<MediaStorageSummary> {
    const currentUserId = await ensureLocalUser();
    return getMediaStorageSummaryService(
      { requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId },
      { quotaMode: 'device' },
    );
  }

  async listForOwner(ownerTable: LinkOwnerTable, ownerId: number, treeId?: number | null, ownerFact?: MediaOwnerFact): Promise<Media[]> {
    const currentUserId = await ensureLocalUser();
    return listMediaForOwnerService({ ownerTable, ownerId, ownerFact, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async listGalleryForOwner(ownerTable: MediaOwnerTable, ownerId: number, treeId?: number | null, ownerFact?: MediaOwnerFact): Promise<OwnerGalleryMedia[]> {
    const currentUserId = await ensureLocalUser();
    return listGalleryForOwnerService({ ownerTable, ownerId, ownerFact, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async unlinkFromOwner(id: number, ownerTable: LinkOwnerTable, ownerId: number, treeId?: number | null, ownerFact?: MediaOwnerFact): Promise<void> {
    const currentUserId = await ensureLocalUser();
    await unlinkMediaForOwnerService({ mediaId: id, ownerTable, ownerId, ownerFact, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async linkToOwner(mediaId: number, ownerTable: LinkOwnerTable, ownerId: number, treeId?: number | null, ownerFact?: MediaOwnerFact): Promise<void> {
    const currentUserId = await ensureLocalUser();
    await linkMediaForOwnerService({ mediaId, ownerTable, ownerId, ownerFact, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async listLinkOwners(mediaId: number, treeId?: number | null): Promise<MediaLinkOwner[]> {
    const currentUserId = await ensureLocalUser();
    return listLinkOwnersForMediaService({ mediaId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async update(id: number, patch: UpdateMediaInput, treeId?: number | null): Promise<Audited<Media>> {
    const currentUserId = await ensureLocalUser();
    const media = await updateMediaService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, id, body: patch as Record<string, unknown> });
    if (!media) throw new NotFoundError('Media not found');
    return media;
  }

  async setPrimary(mediaId: number, personId: number, treeId?: number | null): Promise<Audited> {
    const currentUserId = await ensureLocalUser();
    return setPrimaryMediaService({
      requestedTreeId: treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
      mediaId,
      personId,
    });
  }

  async clearPrimary(mediaId: number, personId: number, treeId?: number | null): Promise<Audited> {
    const currentUserId = await ensureLocalUser();
    return clearPrimaryMediaService({
      requestedTreeId: treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
      mediaId,
      personId,
    });
  }

  async setFamilyPhoto(mediaId: number, familyId: number, treeId?: number | null): Promise<Audited> {
    const currentUserId = await ensureLocalUser();
    return setFamilyPhotoService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, mediaId, familyId });
  }

  async clearFamilyPhoto(mediaId: number, familyId: number, treeId?: number | null): Promise<Audited> {
    const currentUserId = await ensureLocalUser();
    return clearFamilyPhotoService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, mediaId, familyId });
  }

  async listTags(mediaId: number, treeId?: number | null): Promise<MediaTagWithPerson[]> {
    const currentUserId = await ensureLocalUser();
    return listTagsService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, mediaId });
  }

  async createTag(mediaId: number, input: CreateMediaTagInput, treeId?: number | null): Promise<Audited<MediaTag>> {
    const currentUserId = await ensureLocalUser();
    return createTagService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, mediaId, body: input as unknown as Record<string, unknown> });
  }

  async updateTag(mediaId: number, tagId: number, input: UpdateMediaTagInput, treeId?: number | null): Promise<Audited<MediaTagWithPerson>> {
    const currentUserId = await ensureLocalUser();
    return updateTagService({
      requestedTreeId: treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
      mediaId,
      tagId,
      body: input as unknown as Record<string, unknown>,
    });
  }

  async removeTag(mediaId: number, tagId: number, treeId?: number | null): Promise<void> {
    const currentUserId = await ensureLocalUser();
    return removeTagService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, mediaId, tagId });
  }

  async remove(id: number, treeId?: number | null): Promise<void> {
    const currentUserId = await ensureLocalUser();
    const ok = await deleteMediaService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, id });
    if (!ok) throw new NotFoundError('Media not found');
  }

  async removeMany(ids: number[], treeId?: number | null): Promise<MediaDeleteBatchResult> {
    const currentUserId = await ensureLocalUser();
    return deleteMediaBatchService({
      requestedTreeId: treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
      ids,
    });
  }

  async listFaceQueue(options?: { resolved?: boolean; countOnly?: boolean; mediaId?: number }, treeId?: number | null): Promise<{ groups: FaceGroup[]; pendingTotal: number; resolvedTotal: number }> {
    const currentUserId = await ensureLocalUser();
    return listFaceQueueService({
      requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId,
      resolved: options?.resolved, countOnly: options?.countOnly, mediaId: options?.mediaId,
    });
  }

  async confirmFaces(candidateIds: number[], personId: number, treeId?: number | null): Promise<FaceConfirmBatchResult> {
    const currentUserId = await ensureLocalUser();
    return confirmFacesService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, candidateIds, personId });
  }

  async repointFaces(candidateIds: number[], personId: number, treeId?: number | null): Promise<{ repointed: number; personName: string | null; previous: FaceSuggestionSnapshot[] }> {
    const currentUserId = await ensureLocalUser();
    return repointFacesService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, candidateIds, personId });
  }

  async restoreFaceSuggestions(previous: FaceSuggestionSnapshot[], treeId?: number | null): Promise<{ restored: number }> {
    const currentUserId = await ensureLocalUser();
    return restoreFaceSuggestionsService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, previous });
  }

  async dismissFaces(candidateIds: number[], reason: FaceDismissReason, treeId?: number | null): Promise<{ dismissed: number }> {
    const currentUserId = await ensureLocalUser();
    return dismissFacesService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, candidateIds, reason });
  }

  async undoFaces(candidateIds: number[], treeId?: number | null): Promise<{ restored: number; skipped: number }> {
    const currentUserId = await ensureLocalUser();
    return undoFacesService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, candidateIds });
  }

  async upload(input: UploadMediaInput, treeId?: number | null): Promise<Media> {
    const uploadIntentId = validateUploadIntentId(input.uploadIntentId);
    const currentUserId = await ensureLocalUser();
    const { file } = input;

    const targets = await resolveMediaUploadTargets({
      requestedTreeId: treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
      personId: input.personId ?? null,
      caseId: input.caseId ?? null,
      ownerTable: input.ownerTable ?? null,
      ownerRecordId: input.ownerRecordId ?? null,
      ownerFact: input.ownerFact ?? null,
    });

    if (!ALLOWED_EXTENSIONS.has(fileExtension(file.name))) {
      throw new ValidationError(`File type not allowed. Allowed types: ${[...ALLOWED_EXTENSIONS].join(', ')}`);
    }
    const kind = classifyUpload(file.name, file.type);
    if (!kind) throw new ValidationError('Only image and PDF files are allowed');
    if (kind === 'pdf' && input.isPrimary) throw new ValidationError('A document cannot be a portrait');

    // Hash the original bytes before the browser quota gate only when there is
    // an intent to replay. Ordinary uploads retain the existing early quota
    // rejection and do not read/process a file that cannot fit.
    let rawBytes: Uint8Array | undefined;
    let contentHash: string | undefined;
    const effectiveTreeId = targets.scope.treeId;
    if (uploadIntentId) {
      rawBytes = new Uint8Array(await file.arrayBuffer());
      contentHash = await hashBytes(rawBytes);
      const existing = await getMediaByUploadIntent(uploadIntentId, effectiveTreeId);
      if (existing) return verifyUploadIntentIdentity(existing, targets, contentHash);
    }

    await assertBrowserStorageCapacity(file.size);
    const { bytes, contentType, format } = kind === 'pdf' ? await processPdfForUpload(file) : await processForUpload(file);

    if (!rawBytes) rawBytes = new Uint8Array(await file.arrayBuffer());
    if (!contentHash) contentHash = await hashBytes(rawBytes);

    // Same identity the hosted path records: the ORIGINAL bytes, so a photo
    // hashes identically whichever build uploaded it (#592).
    const tx = await getClient();
    let media: Media;
    let created = false;
    try {
      await tx.query('BEGIN');
      if (uploadIntentId) {
        const existing = await getMediaByUploadIntent(uploadIntentId, effectiveTreeId, tx, true);
        if (existing) {
          media = await verifyUploadIntentIdentity(existing, targets, contentHash, tx);
          await tx.query('COMMIT');
          return media;
        }
      }
      const links = uploadLinks(targets);
      media = await createCanonicalMedia({
        data: {
          UserId: targets.scope.ownerId,
          TreeId: effectiveTreeId,
          Title: input.title || file.name,
          FilePath: null,
          Format: format,
          ContentType: contentType,
          FileSize: bytes.length,
          ContentHash: contentHash,
          UploadIntentId: uploadIntentId,
          UploadIntentTarget: uploadIntentId ? serializeUploadIntentTarget(targets) : null,
        },
        links,
        primaryPersonId: input.isPrimary && targets.personId !== null
          ? targets.personId
          : undefined,
        actingUserId: currentUserId,
      }, tx);
      await tx.query(`INSERT INTO "MediaBlob" ("MediaId", "Data") VALUES ($1, $2)`, [media.Id, bytes]);
      if (targets.caseId !== null) {
        await tx.query(
          `INSERT INTO "CaseMedia" ("CaseId", "MediaId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [targets.caseId, media.Id],
        );
      }
      await tx.query('COMMIT');
      created = true;
    } catch (error) {
      await safeRollback(tx);
      if (uploadIntentId && isUniqueViolation(error)) {
        const existing = await getMediaByUploadIntent(uploadIntentId, effectiveTreeId, tx);
        if (existing) return verifyUploadIntentIdentity(existing, targets, contentHash, tx);
      }
      const storageError = asStorageLimitError(error);
      if (storageError) throw storageError;
      throw error;
    } finally {
      tx.release();
    }

    if (!created) return media;
    // A document has no faces or photo metadata to read, and no image thumbnail.
    if (kind === 'pdf') return media;

    // Same face capture as the hosted path — the desktop build is where a
    // digiKam user actually works, so it cannot be the half that skips this.
    try {
      const { captured, caption, takenDate } = await captureFacesForMedia(rawBytes, media.Id, effectiveTreeId);
      media.FacesFound = captured;
      if (!input.title && caption) {
        await patchMediaTitle(media.Id, effectiveTreeId, caption);
        media.Title = caption;
      }
      if (takenDate && !media.Date && await patchMediaDateIfUnset(media.Id, effectiveTreeId, takenDate)) {
        media.Date = takenDate;
      }
    } catch { /* enrichment is deliberately best-effort after core commit */ }

    // Generate a thumbnail up front from the already-processed bytes so the first
    // avatar render never pays the full-blob read. Best-effort — SVG/GIF return
    // null (no thumb; getThumb falls back to the full blob).
    try {
      const thumb = await downscaleToThumb(bytes, contentType, 256);
      if (thumb) {
        await query(
          `INSERT INTO "MediaThumb" ("MediaId", "Data") VALUES ($1, $2) ON CONFLICT ("MediaId") DO NOTHING`,
          [media.Id, thumb.bytes],
        );
      }
    } catch { /* thumbnail generation/storage is best-effort after core commit */ }
    return media;
  }

  /**
   * Same tree-scoped lookup the hosted route performs, minus the HTTP hop. The
   * service owns validation, so the local build gets identical guarantees
   * rather than a laxer copy (#592).
   */
  async findDuplicates(hashes: string[], treeId?: number | null): Promise<DuplicateMatch[]> {
    const currentUserId = await ensureLocalUser();
    return findDuplicatesService({
      hashes,
      requestedTreeId: treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
    });
  }

  async getFile(id: number, treeId?: number | null): Promise<{ bytes: Uint8Array; contentType: string }> {
    const currentUserId = await ensureLocalUser();
    const effectiveTreeId = treeId ?? await resolveDefaultTree(currentUserId);
    if (takeNoBlobNote(id, effectiveTreeId)) throw new NotFoundError('Media file not found');
    const file = await readBlob(id, effectiveTreeId);
    if (!file) throw new NotFoundError('Media file not found');
    return file;
  }

  /**
   * Returns a ~256px thumbnail (always JPEG when generated). Lazy
   * generate-on-read: a MediaThumb hit is served directly; a miss reads the full
   * blob once, downscales in-canvas, stores it, and returns it — so pre-existing
   * photos self-heal without a migration. SVG/GIF (and decode failures) have no
   * thumb and fall back to the full blob bytes.
   *
   * Global `query()` only — never `getClient()` (an open BEGIN would deadlock
   * PGlite's single connection). The async downscale runs between two serialized
   * queries, so a concurrent generation is possible; `ON CONFLICT DO NOTHING`
   * makes the insert idempotent.
   */
  async getThumb(id: number, treeId?: number | null): Promise<{ bytes: Uint8Array; contentType: string }> {
    const currentUserId = await ensureLocalUser();
    const effectiveTreeId = treeId ?? await resolveDefaultTree(currentUserId);

    // Hit: return the stored thumbnail (always JPEG), batched with concurrent reads.
    const state = await readThumbState(id, effectiveTreeId);
    if (!state) throw new NotFoundError('Media file not found');
    if (state.thumb) return { bytes: state.thumb, contentType: 'image/jpeg' };
    // No file at all (an import's unresolved reference): nothing to generate from.
    if (!state.hasBlob) {
      noteNoBlob(id, effectiveTreeId);
      throw new NotFoundError('Media file not found');
    }

    // Miss: read the full blob, generate + store a thumb, return it.
    return withThumbGenerationSlot(async () => {
      const file = await readBlob(id, effectiveTreeId);
      if (!file) throw new NotFoundError('Media file not found');

      const { bytes: fullBytes, contentType } = file;
      const thumb = await downscaleToThumb(fullBytes, contentType, 256);
      if (!thumb) return { bytes: fullBytes, contentType }; // SVG/GIF/decode-fail: serve full, don't store

      await query(
        `INSERT INTO "MediaThumb" ("MediaId", "Data") VALUES ($1, $2) ON CONFLICT ("MediaId") DO NOTHING`,
        [id, thumb.bytes],
      );
      return { bytes: thumb.bytes, contentType: thumb.contentType };
    });
  }
}
