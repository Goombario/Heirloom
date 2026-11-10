import type { TreeClient, TreeCounts, TreeGetParams } from '../types';
import type { TreeData } from '@/app/components/tree/types';
import { getTreeService } from '@/lib/services/tree';
import { getTreeCountsService } from '@/lib/services/tree-counts';
import { ensureLocalUser } from '../local-user';

/**
 * Tree methods backed by in-browser PGlite.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree);
 * `requestedOwnerId` stays null (sharing is a hosted-only concept).
 */
export class LocalTreeClient implements TreeClient {
  async get(params: TreeGetParams): Promise<TreeData> {
    const currentUserId = await ensureLocalUser();
    return getTreeService({
      id: params.id,
      mode: params.mode,
      requestedTreeId: params.treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
    });
  }

  async getCounts(treeId?: number | null): Promise<TreeCounts> {
    const currentUserId = await ensureLocalUser();
    return getTreeCountsService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }
}
