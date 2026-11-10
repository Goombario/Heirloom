import type { DashboardClient, DashboardData, Suggestion } from '../types';
import { getDashboardService, getSuggestionsService } from '@/lib/services/dashboard';
import { ensureLocalUser } from '../local-user';

/**
 * Dashboard methods backed by in-browser PGlite.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree);
 * `requestedOwnerId` stays null (sharing is a hosted-only concept).
 */
export class LocalDashboardClient implements DashboardClient {
  async get(treeId?: number | null): Promise<DashboardData> {
    const currentUserId = await ensureLocalUser();
    return getDashboardService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async suggestions(treeId?: number | null): Promise<Suggestion[]> {
    const currentUserId = await ensureLocalUser();
    return getSuggestionsService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }
}
