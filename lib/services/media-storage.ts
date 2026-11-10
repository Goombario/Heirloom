import { getMediaStorageUsed } from '@/lib/db/queries/media';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import type { MediaStorageSummary } from '@/lib/data/types';
import { getTreeMediaQuotaBytes } from '@/lib/media/storage-quota';

export interface MediaStorageSummaryParams {
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * Read the storage summary for one authorized tree. Scope resolution happens
 * exactly once here; the aggregate query receives only the resolved TreeId.
 */
export async function getMediaStorageSummaryService(
  params: MediaStorageSummaryParams,
  options: { quotaMode?: 'tree' | 'device' } = {},
): Promise<MediaStorageSummary> {
  const scope = await resolveTreeScope(
    { treeId: params.requestedTreeId, ownerId: params.requestedOwnerId },
    params.currentUserId,
  );
  const usedBytes = await getMediaStorageUsed(scope.treeId);
  const configuredLimit = options.quotaMode === 'device' ? null : getTreeMediaQuotaBytes();
  const limitBytes = configuredLimit;

  return {
    usedBytes,
    limitBytes,
    remainingBytes: limitBytes === null ? null : Math.max(0, limitBytes - usedBytes),
    percentUsed: limitBytes === null ? null : (usedBytes / limitBytes) * 100,
    quotaMode: limitBytes === null ? 'device' : 'tree',
  };
}
