import { findMediaByHashes } from '@/lib/db/queries/media';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { CONTENT_HASH_PATTERN } from '@/lib/media/content-hash';
import { ValidationError } from '@/lib/validation';
import type { DuplicateMatch } from '@/lib/data/types';

/**
 * Upper bound on one pre-flight batch, so a single request cannot turn into an
 * unbounded `= ANY(...)`. Comfortably above any realistic album import; the
 * client chunks beyond it.
 */
export const MAX_DUPLICATE_HASHES = 500;

export interface FindDuplicatesParams {
    /** Unvalidated: this is the trust boundary, so the shape is checked here. */
    hashes: unknown;
    requestedTreeId: number | null;
    requestedOwnerId: number | null;
    currentUserId: number;
}

/**
 * Read-only duplicate lookup backing the upload pre-flight (#592).
 *
 * Validation lives in the service rather than the route so the local (PGlite)
 * client gets identical guarantees — it calls this directly, with no HTTP layer
 * to enforce anything on its behalf.
 */
export async function findDuplicatesService(params: FindDuplicatesParams): Promise<DuplicateMatch[]> {
    const { hashes, requestedTreeId, requestedOwnerId, currentUserId } = params;

    if (!Array.isArray(hashes)) {
        throw new ValidationError('hashes must be an array');
    }
    if (hashes.length > MAX_DUPLICATE_HASHES) {
        throw new ValidationError(`At most ${MAX_DUPLICATE_HASHES} hashes per request`);
    }
    for (const h of hashes) {
        if (typeof h !== 'string' || !CONTENT_HASH_PATTERN.test(h)) {
            throw new ValidationError('Each hash must be a lowercase hex SHA-256');
        }
    }
    // Short-circuit before resolving scope: an empty batch has nothing to ask.
    if (hashes.length === 0) return [];

    // Read-only, but still scope-resolved: answering a hash lookup for a tree
    // the caller cannot read would disclose which photos that tree holds.
    const scope = await resolveTreeScope(
        { treeId: requestedTreeId, ownerId: requestedOwnerId },
        currentUserId,
    );

    const rows = await findMediaByHashes(hashes as string[], scope.treeId);
    return rows.map(row => ({
        hash: row.ContentHash,
        mediaId: row.Id,
        title: row.Title,
        reason: 'in-tree' as const,
    }));
}
