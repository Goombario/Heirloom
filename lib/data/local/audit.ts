import type { AuditClient, AuditListOptions, AuditListResult, AuditEditorsResult } from '../types';
import { listAuditService, listAuditEditorsService, revertAuditService } from '@/lib/services/audit';
import { ensureLocalUser } from '../local-user';

/**
 * Audit methods backed by in-browser PGlite.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree);
 * `requestedOwnerId` stays null (sharing is a hosted-only concept).
 */
export class LocalAuditClient implements AuditClient {
  async list(options?: AuditListOptions): Promise<AuditListResult> {
    const currentUserId = await ensureLocalUser();
    return listAuditService({
      requestedTreeId: options?.treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
      page: options?.page,
      pageSize: options?.pageSize,
      entityType: options?.entityType,
      action: options?.action,
      who: options?.who,
      dateFrom: options?.dateFrom,
      dateTo: options?.dateTo,
      search: options?.search,
      sort: options?.sort,
      dir: options?.dir,
    });
  }

  async users(treeId?: number | null): Promise<AuditEditorsResult> {
    const currentUserId = await ensureLocalUser();
    return listAuditEditorsService({ requestedTreeId: treeId ?? null,
 requestedOwnerId: null, currentUserId });
  }

  async revert(
    ids: number[],
    treeId?: number | null
  ): Promise<{ success: true; revertedCount: number }> {
    const currentUserId = await ensureLocalUser();
    return revertAuditService({ ids, requestedTreeId: treeId ?? null,
 requestedOwnerId: null, currentUserId });
  }
}
