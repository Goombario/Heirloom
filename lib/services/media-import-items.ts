import { getClient } from '@/lib/db/connection';
import {
  deleteUnresolvedMediaImportItem,
  listUnresolvedMediaImportItems,
  lockMediaImportItem,
  transitionMediaImportItem,
} from '@/lib/db/queries/media-import-items';
import { deleteMediaRow, getMediaById } from '@/lib/db/queries/media';
import { auditDelete } from '@/lib/db/queries/audit-capture';
import { resolveTreeScope, type TreeScope } from '@/lib/db/queries/trees';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import type { MediaImportItem } from '@/lib/db/schema';
import type { MediaImportMaterializationOutcome } from '@/lib/data/types';
import { safeRollback } from '@/lib/db/rollback';

export interface ImportMediaScopeContext {
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

export const MAX_MISSING_MEDIA_BATCH = 100;

function requireWrite(scope: TreeScope): void {
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }
}

function requireDelete(scope: TreeScope): void {
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }
}

function validateItemIds(itemIds: unknown): number[] {
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    throw new ValidationError('itemIds must be a non-empty array');
  }
  if (itemIds.length > MAX_MISSING_MEDIA_BATCH) {
    throw new ValidationError(`itemIds must contain at most ${MAX_MISSING_MEDIA_BATCH} items`);
  }
  if (!itemIds.every((id) => Number.isInteger(id) && (id as number) > 0)) {
    throw new ValidationError('itemIds must contain positive integer IDs');
  }
  const unique = [...new Set(itemIds as number[])];
  if (unique.length !== itemIds.length) {
    throw new ValidationError('itemIds must not contain duplicates');
  }
  return unique.sort((a, b) => a - b);
}

async function resolveImportScope(ctx: ImportMediaScopeContext): Promise<TreeScope> {
  return resolveTreeScope(
    { treeId: ctx.requestedTreeId, ownerId: ctx.requestedOwnerId },
    ctx.currentUserId,
  );
}

async function resolveMutationScope(ctx: ImportMediaScopeContext): Promise<TreeScope> {
  try {
    return await resolveImportScope(ctx);
  } catch (error) {
    // Item materialize/delete intentionally do not reveal whether an explicit
    // inaccessible tree exists. A shared view-only tree resolves successfully
    // and is rejected by the permission ladder below with 403.
    if (error instanceof AccessError) throw new NotFoundError('Media import item not found');
    throw error;
  }
}

export async function listUnresolvedImportMediaService(
  ctx: ImportMediaScopeContext,
): Promise<MediaImportItem[]> {
  const scope = await resolveImportScope(ctx);
  return listUnresolvedMediaImportItems(scope.treeId);
}

export async function markImportMediaMissingService(
  ctx: ImportMediaScopeContext & { itemIds: number[] },
): Promise<MediaImportItem[]> {
  const ids = validateItemIds(ctx.itemIds);
  const scope = await resolveImportScope(ctx);
  requireWrite(scope);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const locked: MediaImportItem[] = [];
    for (const id of ids) {
      const item = await lockMediaImportItem(id, scope.treeId, client);
      // A foreign-tree or inaccessible item is intentionally indistinguishable
      // from a missing item, and the whole batch remains untouched.
      if (!item) throw new NotFoundError('Media import item not found');
      locked.push(item);
    }
    const result: MediaImportItem[] = [];
    for (const item of locked) {
      if (item.status === 'ready') {
        result.push(item);
        continue;
      }
      const transitioned = await transitionMediaImportItem(
        item.id, scope.treeId, 'missing', 'archive_file_missing', client,
      );
      if (!transitioned) throw new NotFoundError('Media import item not found');
      result.push(transitioned);
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function removeUnresolvedImportMediaService(
  ctx: ImportMediaScopeContext & { itemId: number },
): Promise<void> {
  if (!Number.isInteger(ctx.itemId) || ctx.itemId <= 0) {
    throw new ValidationError('Invalid media import item ID');
  }
  const scope = await resolveMutationScope(ctx);
  requireDelete(scope);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const item = await lockMediaImportItem(ctx.itemId, scope.treeId, client);
    if (!item || item.status === 'ready') {
      throw new NotFoundError('Media import item not found');
    }
    const media = await getMediaById(item.mediaId, scope.treeId, client);
    if (!media) throw new NotFoundError('Media import item not found');
    await auditDelete('media', media as unknown as Record<string, unknown>, media.UserId, ctx.currentUserId, client);
    if (!await deleteMediaRow(item.mediaId, scope.treeId, client)) {
      throw new NotFoundError('Media import item not found');
    }
    // The Media FK cascade removes the item, links, tags, blob, and thumbnail
    // together. Keep this query available for explicit lineage semantics and to
    // guard against a legacy database missing the cascade.
    await deleteUnresolvedMediaImportItem(ctx.itemId, scope.treeId, client);
    await client.query('COMMIT');
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Remove several unresolved items in one transaction (#859), so clearing an
 * abandoned import doesn't take one request per photo. Items that are already
 * ready, already gone or outside the tree are skipped rather than failing the
 * batch: the list the user picked from can be stale while an import finishes in
 * the background. Returns the ids actually removed.
 */
export async function removeUnresolvedImportMediaBatchService(
  ctx: ImportMediaScopeContext & { itemIds: number[] },
): Promise<number[]> {
  const ids = validateItemIds(ctx.itemIds);
  const scope = await resolveMutationScope(ctx);
  requireDelete(scope);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const removed: number[] = [];
    for (const id of ids) {
      const item = await lockMediaImportItem(id, scope.treeId, client);
      if (!item || item.status === 'ready') continue;
      const media = await getMediaById(item.mediaId, scope.treeId, client);
      if (!media) continue;
      await auditDelete('media', media as unknown as Record<string, unknown>, media.UserId, ctx.currentUserId, client);
      if (!await deleteMediaRow(item.mediaId, scope.treeId, client)) continue;
      await deleteUnresolvedMediaImportItem(id, scope.treeId, client);
      removed.push(id);
    }
    await client.query('COMMIT');
    return removed;
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
}

/** Best-effort stable failure persistence shared by local and hosted clients. */
export async function recordImportMediaFailureService(params: {
  itemId: number;
  treeId: number;
  failureCode: import('@/lib/db/schema').MediaImportFailureCode;
}): Promise<MediaImportItem | null> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const current = await lockMediaImportItem(params.itemId, params.treeId, client);
    if (!current) {
      await client.query('ROLLBACK');
      return null;
    }
    if (current.status === 'ready') {
      await client.query('COMMIT');
      return current;
    }
    const failed = await transitionMediaImportItem(
      params.itemId, params.treeId, 'failed', params.failureCode, client,
    );
    await client.query('COMMIT');
    return failed;
  } catch {
    await safeRollback(client);
    return null;
  } finally {
    client.release();
  }
}

/** The outcome for an item settled onto an existing photo; its own row is gone (#858). */
export function reusedOutcome(item: MediaImportItem, mediaId: number): MediaImportMaterializationOutcome {
  return {
    outcome: 'ready', item: { ...item, mediaId, status: 'ready', failureCode: null },
    failureCode: null, retryable: false, reused: true,
  };
}
