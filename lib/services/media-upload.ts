import { writeFile, mkdir, readFile, unlink } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import {
    getMediaByUploadIntent,
    getMediaStorageUsed,
    patchMediaFile,
    patchMediaTitle,
    patchMediaDateIfUnset,
} from '@/lib/db/queries/media';
import {
    findReusableImportMedia, getMediaImportItem, listStoredSizeReuseCandidates, lockMediaImportItem, reuseMediaForImportItem, transitionMediaImportItem,
} from '@/lib/db/queries/media-import-items';
import { reusedOutcome } from '@/lib/services/media-import-items';
import { createCanonicalMedia } from '@/lib/services/media';
import { captureFacesForMedia } from '@/lib/services/media-face-capture';
import { resolveMediaUploadTargets, uploadLinks, type ValidatedMediaUploadTargets } from '@/lib/services/media-upload-targets';
import { resolveTreeScope, lockTreeForUpdate } from '@/lib/db/queries/trees';
import { getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import { AccessError, FileTooLargeError, NotFoundError, StorageLimitError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import { getDataDir } from '@/lib/data-dir';
import { ALLOWED_EXTENSIONS, PDF_CONTENT_TYPE, classifyUpload, hasPdfSignature,
    hasPassthroughImageSignature, type UploadKind } from '@/lib/media/allowed-extensions';
import { hashBytes } from '@/lib/media/content-hash';
import type { Media, MediaImportFailureCode, MediaImportItem } from '@/lib/db/schema';
import { clearPrimaryMediaLinksForMedia, type DbExecutor } from '@/lib/db/queries/media-links';
import type { MediaImportMaterializationOutcome } from '@/lib/data/types';
import { normalizeArchivePath } from '@/lib/gedcom/media-match';
import { resolveHostedMediaFile } from '@/lib/services/gedcom-export';
import { serializeUploadIntentTarget, verifyUploadIntentIdentity } from '@/lib/services/media-upload-intent';
import { isUniqueViolation } from '@/lib/media/upload-intent';
import { primeThumbnailCache } from '@/lib/media-thumbnail';
import { sharpForUntrustedInput, withSharpSlot } from '@/lib/sharp-resource';
import { formatBytes, getTreeMediaQuotaBytes } from '@/lib/media/storage-quota';

/**
 * POST /api/media/upload business logic (interactive + GEDCOM-import-patch
 * branches). The route keeps HTTP concerns only: auth, rate limiting, formData
 * extraction, and error→status mapping (ValidationError 400, AccessError 403,
 * NotFoundError 404, StorageLimitError/ENOSPC 507).
 */

// Media limits exist to protect a SHARED hosted service. They are environment
// configuration rather than constants so a self-hosted deployment can raise them
// without a rebuild; the defaults are the previous hard-coded values, so the
// hosted deployment is unchanged. Read at call time, not module load, so tests
// and runtime env changes are not baked in at import.
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB per file

function envBytes(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number(raw);
    // A malformed value falls back rather than disabling the limit outright.
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Formats that pass through unchanged — SVG is vector, GIF may be animated.
const SKIP_COMPRESSION = new Set(['.svg', '.gif']);
const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 85;

/** Stable contexts for privacy-safe generated-file cleanup diagnostics. */
export type GeneratedMediaCleanupContext = 'interactive_upload' | 'import_materialization';

/** Best-effort cleanup; never put a user filesystem path or raw error in logs. */
export async function cleanupGeneratedMediaFile(
    filepath: string,
    context: GeneratedMediaCleanupContext,
): Promise<void> {
    try {
        await unlink(filepath);
    } catch {
        console.error('Generated media cleanup failed', {
            category: 'generated_media_cleanup_failed',
            context,
        });
    }
}

// Compresses a raster image to JPEG (max 2048px, quality 85).
// Applies EXIF orientation before resizing so phone photos display correctly.
// SVG and GIF are returned unchanged.
async function compressImage(
    inputBuffer: Buffer,
    originalExt: string
): Promise<{ buffer: Buffer; ext: string; contentType: string; format: string }> {
    if (SKIP_COMPRESSION.has(originalExt)) {
        if (!hasPassthroughImageSignature(originalExt, inputBuffer)) {
            throw new ValidationError(`The file is not a valid ${originalExt.slice(1).toUpperCase()} image`);
        }
        return {
            buffer: inputBuffer,
            ext: originalExt,
            contentType: originalExt === '.svg' ? 'image/svg+xml' : 'image/gif',
            format: originalExt.slice(1).toUpperCase(),
        };
    }
    const compressed = await withSharpSlot(() => sharpForUntrustedInput(inputBuffer)
        .rotate()  // Apply + strip EXIF orientation
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer());
    return { buffer: compressed, ext: '.jpg', contentType: 'image/jpeg', format: 'JPG' };
}

/**
 * Cheap per-file validation (size / extension / MIME). Kept separate from
 * compression so ownership checks (person-in-tree, case) can run BEFORE the
 * expensive `sharp` pass — a cross-tree target or a corrupt image must fail its
 * 404/403 without first burning a compression, matching the old route order.
 */
export function validateUploadFile(file: File | null): { file: File; ext: string; kind: UploadKind } {
    if (!file) throw new ValidationError('No file uploaded');
    // Skipped in desktop mode, where the disk is the user's own — matching the
    // per-tree quota gate below, which already had this exemption.
    if (process.env.DESKTOP_MODE !== 'true') {
        const maxFileBytes = envBytes('MEDIA_MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES);
        if (file.size > maxFileBytes) {
            throw new FileTooLargeError(`File size exceeds ${formatBytes(maxFileBytes)} limit`, maxFileBytes);
        }
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new ValidationError(`File type not allowed. Allowed types: ${[...ALLOWED_EXTENSIONS].join(', ')}`);
    }
    const kind = classifyUpload(file.name, file.type);
    if (!kind) throw new ValidationError('Only image and PDF files are allowed');

    return { file, ext, kind };
}

/**
 * Read the file's bytes and run the compression pass. A PDF is stored as it
 * came, once its bytes prove it is one; there is nothing to compress.
 */
async function readAndCompress(file: File, ext: string, kind: UploadKind): Promise<{
    buffer: Buffer;
    outExt: string;
    contentType: string;
    format: string;
    /** ORIGINAL bytes, pre-compression — the only place XMP still exists. */
    rawBuffer: Buffer;
    /**
     * SHA-256 of the ORIGINAL bytes (#592). Taken here, before compression,
     * because the compressed output is not a stable identity: a sharp/libvips
     * upgrade would change it for the same input file.
     */
    contentHash: string;
}> {
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const contentHash = await hashBytes(rawBuffer);
    if (kind === 'pdf') {
        if (!hasPdfSignature(rawBuffer)) throw new ValidationError('The file is not a valid PDF');
        return { buffer: rawBuffer, outExt: '.pdf', contentType: PDF_CONTENT_TYPE, format: 'PDF', rawBuffer, contentHash };
    }
    const { buffer, ext: outExt, contentType, format } = await compressImage(rawBuffer, ext);
    return { buffer, outExt, contentType, format, rawBuffer, contentHash };
}

/** Per-tree quota gate (skipped in desktop mode, where the disk is the user's own). */
async function assertWithinStorageLimit(
    treeId: number,
    incomingBytes: number,
    exec?: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }> },
): Promise<void> {
    const quotaBytes = getTreeMediaQuotaBytes();
    if (quotaBytes === null) return;
    const storageUsed = await getMediaStorageUsed(treeId, exec);
    if (storageUsed + incomingBytes > quotaBytes) {
        throw new StorageLimitError(
            `Storage limit of ${formatBytes(quotaBytes)} reached for this tree. Delete some media to free up space.`,
            {
                usedBytes: storageUsed,
                limitBytes: quotaBytes,
                remainingBytes: Math.max(0, quotaBytes - storageUsed),
            },
        );
    }
}

async function storageExhaustedError(treeId: number): Promise<StorageLimitError> {
    const quotaBytes = getTreeMediaQuotaBytes();
    if (quotaBytes === null) {
        return new StorageLimitError('Storage limit reached. Please contact your administrator to free up space.');
    }
    const usedBytes = await getMediaStorageUsed(treeId);
    return new StorageLimitError(
        'Storage limit reached. Please contact your administrator to free up space.',
        {
            usedBytes,
            limitBytes: quotaBytes,
            remainingBytes: Math.max(0, quotaBytes - usedBytes),
        },
    );
}

export interface UploadMediaParams {
    file: File | null;
    title: string | null;
    isPrimary: boolean;
    personId: number | null;
    caseId: number | null;
    ownerTable: string | null;
    ownerRecordId: number | null;
    ownerFact?: string | null;
    requestedTreeId: number | null;
    requestedOwnerId: number | null;
    currentUserId: number;
    uploadIntentId?: string | null;
}

async function persistCanonicalMedia(
    targets: ValidatedMediaUploadTargets,
    data: Parameters<typeof createCanonicalMedia>[0]['data'],
    actingUserId: number,
    isPrimary: boolean,
    incomingBytes: number,
): Promise<{ media: Media; created: boolean }> {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        if (data.UploadIntentId) {
            const existing = await getMediaByUploadIntent(data.UploadIntentId, targets.scope.treeId, client, true);
            if (existing) {
                await verifyUploadIntentIdentity(existing, targets, data.ContentHash ?? '', client);
                await client.query('COMMIT');
                return { media: existing, created: false };
            }
        }
        // Keep the usage check and Media insert under the same per-tree lock.
        // Otherwise concurrent uploads can both observe the old SUM and jointly
        // exceed the configured quota.
        if (!await lockTreeForUpdate(targets.scope.treeId, client)) {
            throw new NotFoundError('Tree not found');
        }
        // A concurrent request with the same intent may have committed while
        // this transaction waited for the tree lock. Recheck before quota so
        // idempotent retries return the stored row even when it filled the tree.
        if (data.UploadIntentId) {
            const existing = await getMediaByUploadIntent(data.UploadIntentId, targets.scope.treeId, client, true);
            if (existing) {
                await verifyUploadIntentIdentity(existing, targets, data.ContentHash ?? '', client);
                await client.query('COMMIT');
                return { media: existing, created: false };
            }
        }
        await assertWithinStorageLimit(targets.scope.treeId, incomingBytes, client);
        const media = await createCanonicalMedia({
            data,
            links: uploadLinks(targets),
            primaryPersonId: isPrimary && targets.personId !== null
                ? targets.personId
                : undefined,
            actingUserId,
        }, client);
        if (targets.caseId !== null) {
            await client.query(
                `INSERT INTO "CaseMedia" ("CaseId", "MediaId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [targets.caseId, media.Id],
            );
        }
        await client.query('COMMIT');
        return { media, created: true };
    } catch (error) {
        await safeRollback(client);
        if (data.UploadIntentId && isUniqueViolation(error)) {
            const existing = await getMediaByUploadIntent(data.UploadIntentId, targets.scope.treeId);
            if (existing) {
                await verifyUploadIntentIdentity(existing, targets, data.ContentHash ?? '');
                return { media: existing, created: false };
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

/** Interactive upload: create a new Media row (plus optional primary/case/owner links). */
export async function uploadMediaService(params: UploadMediaParams): Promise<Media> {
    const {
        file, title, isPrimary, personId, caseId, ownerTable, ownerRecordId, ownerFact = null,
        requestedTreeId, requestedOwnerId, currentUserId, uploadIntentId = null,
    } = params;

    const targets = await resolveMediaUploadTargets({
        requestedTreeId,
        requestedOwnerId,
        currentUserId,
        personId,
        caseId,
        ownerTable,
        ownerRecordId,
        ownerFact,
    });
    const { scope } = targets;

    const { file: upload, ext, kind } = validateUploadFile(file);
    if (kind === 'pdf' && isPrimary) throw new ValidationError('A document cannot be a portrait');

    const { buffer, outExt, contentType, format, rawBuffer, contentHash } = await readAndCompress(upload, ext, kind);

    if (uploadIntentId) {
        const existing = await getMediaByUploadIntent(uploadIntentId, scope.treeId);
        if (existing) return verifyUploadIntentIdentity(existing, targets, contentHash);
    }

    // Files live under the TREE OWNER's uploads dir (relevant when a shared
    // contributor uploads — serving looks there).
    const uploadsDir = path.join(getDataDir(), 'uploads', scope.ownerId.toString(), 'media');
    try {
        await mkdir(uploadsDir, { recursive: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
            throw await storageExhaustedError(scope.treeId);
        }
        throw error;
    }

    // Random suffix: two parallel uploads for the same person in the same
    // millisecond must not collide on filename (silent overwrite = data loss).
    const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const filename = targets.personId !== null ? `${targets.personId}_${stamp}${outExt}` : `case_${stamp}${outExt}`;
    const filepath = path.join(uploadsDir, filename);
    try {
        await writeFile(filepath, buffer);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
            throw await storageExhaustedError(scope.treeId);
        }
        throw error;
    }

    let persisted: { media: Media; created: boolean };
    try {
        persisted = await persistCanonicalMedia(targets, {
            UserId: scope.ownerId,
            TreeId: scope.treeId,
            Title: title || upload.name,
            FilePath: filename,
            Format: format,
            ContentType: contentType,
            FileSize: buffer.length,
            ContentHash: contentHash,
            UploadIntentId: uploadIntentId,
            UploadIntentTarget: uploadIntentId ? serializeUploadIntentTarget(targets) : null,
        }, currentUserId, isPrimary, buffer.length);
    } catch (error) {
        // This request created exactly one random path. Never broaden cleanup to
        // the upload directory or another row's pre-existing file.
        await cleanupGeneratedMediaFile(filepath, 'interactive_upload');
        throw error;
    }

    const { media } = persisted;
    if (!persisted.created) {
        await cleanupGeneratedMediaFile(filepath, 'interactive_upload');
        return media;
    }
    // A document has no thumbnail to prime and no faces or photo metadata to read.
    if (kind === 'pdf') return media;

    try {
        await primeThumbnailCache({
            original: buffer,
            userId: scope.ownerId,
            filename,
            size: 256,
            contentType,
        });
    } catch {
        console.error('Thumbnail priming failed', {
            category: 'thumbnail_prime_failed', context: 'interactive_upload',
        });
    }

    // Stage any faces the photo names in its own metadata (#487). Best-effort:
    // never let a metadata problem fail an upload that already wrote its file.
    try {
        const { captured, caption, takenDate } = await captureFacesForMedia(rawBuffer, media.Id, scope.treeId);
        media.FacesFound = captured;
        // The photo's own caption beats the filename, but never a title the user typed.
        if (!title && caption) {
            await patchMediaTitle(media.Id, scope.treeId, caption);
            media.Title = caption;
        }
        // The photo's own date (original, else created; #802), never over one already set.
        if (takenDate && !media.Date && await patchMediaDateIfUnset(media.Id, scope.treeId, takenDate)) {
            media.Date = takenDate;
        }
    } catch { /* enrichment is deliberately best-effort after core commit */ }

    return media;
}

export interface CreateMetadataMediaParams {
    title: string | null;
    format: string | null;
    contentType: string | null;
    isPrimary: boolean;
    personId: number | null;
    caseId: number | null;
    ownerTable: string | null;
    ownerRecordId: number | null;
    requestedTreeId: number | null;
    requestedOwnerId: number | null;
    currentUserId: number;
}

/** Back-compat metadata factory used by integration/import tooling; no bytes or paths are accepted. */
export async function createMetadataMediaService(params: CreateMetadataMediaParams): Promise<Media> {
    const targets = await resolveMediaUploadTargets(params);
    return (await persistCanonicalMedia(targets, {
        UserId: targets.scope.ownerId,
        TreeId: targets.scope.treeId,
        Title: params.title,
        FilePath: null,
        Format: params.format,
        ContentType: params.contentType,
        FileSize: 0,
        ContentHash: null,
        UploadIntentId: null,
    }, params.currentUserId, params.isPrimary, 0)).media;
}

export interface MaterializeImportMediaParams {
    itemId: number;
    archivePath: string;
    file: File | null;
    requestedTreeId: number | null;
    requestedOwnerId: number | null;
    currentUserId: number;
}

/**
 * Materialize/delete endpoints intentionally hide inaccessible explicit tree
 * scopes as 404. The resolver still returns a scope for an authorized view-only
 * share, so its later permission check remains a real 403.
 */
async function resolveMaterializationScope(
    requestedTreeId: number | null,
    requestedOwnerId: number | null,
    currentUserId: number,
) {
    try {
        return await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
    } catch (error) {
        if (error instanceof AccessError) throw new NotFoundError('Media import item not found');
        throw error;
    }
}

function materializationFailureCode(error: unknown, file: File | null): MediaImportFailureCode {
    const code = typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === 'ENOSPC' || error instanceof StorageLimitError) return 'storage_capacity';
    if (error instanceof ValidationError) {
        if (file && process.env.DESKTOP_MODE !== 'true'
            && file.size > envBytes('MEDIA_MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES)) return 'file_too_large';
        return 'unsupported_media_type';
    }
    // Sharp/libvips failures are intentionally reduced to a stable category.
    if (error instanceof Error && /sharp|libvips|decode|image/i.test(error.message)) return 'decode_failed';
    return 'materialization_failed';
}

async function persistImportFailure(
    itemId: number,
    treeId: number,
    failureCode: MediaImportFailureCode,
): Promise<MediaImportItem | null> {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const current = await lockMediaImportItem(itemId, treeId, client);
        if (!current) {
            await client.query('ROLLBACK');
            return null;
        }
        if (current.status === 'ready') {
            await client.query('COMMIT');
            return current;
        }
        const failed = await transitionMediaImportItem(itemId, treeId, 'failed', failureCode, client);
        await client.query('COMMIT');
        return failed;
    } catch {
        await safeRollback(client);
        // Failure reporting is best effort. The caller must report item:null when
        // even this small transaction could not be persisted.
        return null;
    } finally {
        client.release();
    }
}

function readyOutcome(item: MediaImportItem, outcome: 'ready' | 'already_ready'): MediaImportMaterializationOutcome {
    return { outcome, item, failureCode: null, retryable: false };
}

/**
 * A photo in the tree whose stored file is byte-for-byte `bytes` (#952). An
 * exported photo carries the stored, compressed file, whose hash is not the
 * original upload's `ContentHash`, so the #858 hash match misses it. A file
 * that can't be read safely is simply not a match.
 */
async function findHostedStoredCopy(
    treeId: number,
    ownerId: number,
    placeholderMediaId: number,
    bytes: Buffer,
    client: DbExecutor,
): Promise<number | null> {
    const candidates = await listStoredSizeReuseCandidates(treeId, placeholderMediaId, bytes.length, client);
    if (candidates.length === 0) return null;
    const uploadsDir = path.join(getDataDir(), 'uploads', ownerId.toString(), 'media');
    for (const candidate of candidates) {
        const stored = resolveHostedMediaFile(uploadsDir, candidate.FilePath);
        if (!stored) continue;
        try {
            if ((await readFile(stored.absolutePath)).equals(bytes)) return candidate.Id;
        } catch { /* unreadable: not a match */ }
    }
    return null;
}

/**
 * Materialize one durable import item in hosted mode. The exact archive path is
 * the only retry identity; no basename or media metadata is consulted.
 */
export async function materializeImportMediaService(
    params: MaterializeImportMediaParams,
): Promise<MediaImportMaterializationOutcome> {
    if (!Number.isInteger(params.itemId) || params.itemId <= 0) {
        throw new ValidationError('Invalid media import item ID');
    }
    if (!params.file) throw new ValidationError('No file uploaded');
    const requestedPath = normalizeArchivePath(params.archivePath);
    if (!requestedPath) throw new ValidationError('archivePath must be a safe, non-empty path');

    const scope = await resolveMaterializationScope(
        params.requestedTreeId, params.requestedOwnerId, params.currentUserId,
    );
    if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

    const first = await getMediaImportItem(params.itemId, scope.treeId);
    if (!first) throw new NotFoundError('Media import item not found');
    if (first.status === 'ready') return readyOutcome(first, 'already_ready');
    if (normalizeArchivePath(first.archivePath) !== requestedPath) {
        const failed = await persistImportFailure(params.itemId, scope.treeId, 'archive_path_mismatch');
        return { outcome: 'failed', item: failed, failureCode: 'archive_path_mismatch', retryable: true };
    }

    let upload: File;
    let ext: string;
    let kind: UploadKind;
    try {
        ({ file: upload, ext, kind } = validateUploadFile(params.file));
    } catch (error) {
        const failureCode = materializationFailureCode(error, params.file);
        const failed = await persistImportFailure(params.itemId, scope.treeId, failureCode);
        return { outcome: 'failed', item: failed, failureCode, retryable: true };
    }

    let processed: Awaited<ReturnType<typeof readAndCompress>>;
    try {
        processed = await readAndCompress(upload, ext, kind);
    } catch (error) {
        const failureCode = materializationFailureCode(error, upload);
        const failed = await persistImportFailure(params.itemId, scope.treeId, failureCode);
        return { outcome: 'failed', item: failed, failureCode, retryable: true };
    }

    const client = await getClient();
    let generatedPath: string | null = null;
    let committed: MediaImportItem | null = null;
    let failureCode: MediaImportFailureCode | null = null;
    try {
        await client.query('BEGIN');
        const locked = await lockMediaImportItem(params.itemId, scope.treeId, client);
        if (!locked) throw new NotFoundError('Media import item not found');
        if (locked.status === 'ready') {
            await client.query('COMMIT');
            return readyOutcome(locked, 'already_ready');
        }
        // Serialize every materialization for this tree, not merely this item.
        // Without the Trees row lock, concurrent SUM checks can both observe
        // the same usage and jointly exceed the configured quota.
        if (!await lockTreeForUpdate(scope.treeId, client)) {
            throw new NotFoundError('Media import item not found');
        }
        // The same bytes are already in this tree (a re-imported archive, say):
        // link the existing photo instead of storing a second copy (#858). An
        // exported photo carries its stored bytes, so compare those too (#952).
        const reusable = await findReusableImportMedia(scope.treeId, locked.mediaId, processed.contentHash, client)
            ?? await findHostedStoredCopy(scope.treeId, scope.ownerId, locked.mediaId, processed.rawBuffer, client);
        if (reusable !== null) {
            await reuseMediaForImportItem(locked.mediaId, reusable, scope.treeId, client);
            await client.query('COMMIT');
            return reusedOutcome(locked, reusable);
        }
        await assertWithinStorageLimit(scope.treeId, processed.buffer.length, client);
        const uploadsDir = path.join(getDataDir(), 'uploads', scope.ownerId.toString(), 'media');
        await mkdir(uploadsDir, { recursive: true });
        generatedPath = path.join(uploadsDir, `imported_${Date.now()}_${randomUUID().slice(0, 8)}${processed.outExt}`);
        await writeFile(generatedPath, processed.buffer);
        await patchMediaFile(locked.mediaId, scope.treeId, {
            FilePath: path.basename(generatedPath), ContentType: processed.contentType,
            Format: processed.format, FileSize: processed.buffer.length, ContentHash: processed.contentHash,
        }, client);
        // A GEDCOM `_PRIM` can name any multimedia record; a PDF never becomes a portrait.
        if (kind === 'pdf') await clearPrimaryMediaLinksForMedia(locked.mediaId, client);
        committed = await transitionMediaImportItem(params.itemId, scope.treeId, 'ready', null, client);
        if (!committed) throw new NotFoundError('Media import item not found');
        await client.query('COMMIT');
    } catch (error) {
        await safeRollback(client);
        if (generatedPath) await cleanupGeneratedMediaFile(generatedPath, 'import_materialization');
        if (error instanceof NotFoundError) throw error;
        failureCode = materializationFailureCode(error, upload);
    } finally {
        client.release();
    }

    if (failureCode) {
        const failed = await persistImportFailure(params.itemId, scope.treeId, failureCode);
        return { outcome: 'failed', item: failed, failureCode, retryable: true };
    }

    if (!committed) {
        return { outcome: 'failed', item: null, failureCode: 'materialization_failed', retryable: true };
    }
    if (kind === 'pdf') return readyOutcome(committed, 'ready');
    try {
        await primeThumbnailCache({
            original: processed.buffer,
            userId: scope.ownerId,
            filename: path.basename(generatedPath ?? ''),
            size: 256,
            contentType: processed.contentType,
        });
    } catch {
        console.error('Thumbnail priming failed', {
            category: 'thumbnail_prime_failed', context: 'import_materialization',
        });
    }
    try {
        await captureFacesForMedia(processed.rawBuffer, committed.mediaId, scope.treeId, {
            skipIfTagged: committed.skipFaceCapture,
        });
    } catch { /* enrichment never downgrades a committed ready item */ }
    return readyOutcome(committed, 'ready');
}
