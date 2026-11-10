import { getAuditLog, getAuditEditors, getAuditRefNames, revertAuditEntry, revertAuditEntries } from '@/lib/db/queries/audit';
import { getAuditRecords } from '@/lib/db/queries/audit-records';
import { auditRefIds } from '@/lib/utils/audit-fields';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import type { AuditListResult, AuditEditorsResult } from '@/lib/data/types';

export interface ListAuditParams {
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
  page?: number;
  pageSize?: number;
  entityType?: string;
  action?: string;
  who?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  sort?: string;
  dir?: string;
}

/** GET /api/audit logic: validate access, clamp pagination, then list entries. */
export async function listAuditService(params: ListAuditParams): Promise<AuditListResult> {
  const { requestedTreeId, requestedOwnerId, currentUserId, page = 1, pageSize = 50 } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );

  const clampedPage = Math.max(1, page);
  const clampedPageSize = Math.min(100, Math.max(1, pageSize));

  try {
    const { entries, total } = await getAuditLog(scope.treeId, {
      page: clampedPage,
      pageSize: clampedPageSize,
      entityType: params.entityType,
      action: params.action,
      who: params.who,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      search: params.search,
      sort: params.sort,
      dir: params.dir,
    });
    const ids = auditRefIds(entries);
    const [refs, records] = await Promise.all([
      getAuditRefNames(scope.treeId, ids.people, ids.families),
      getAuditRecords(scope.treeId, entries),
    ]);
    return { entries, total, page: clampedPage, pageSize: clampedPageSize, refs, records };
  } catch (err) {
    if (err instanceof Error && /^Invalid (entityType|action|sort|dir)/.test(err.message)) {
      throw new ValidationError(err.message);
    }
    throw err;
  }
}

export interface ListAuditEditorsParams {
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/audit/users logic: validate access, then list distinct editors. */
export async function listAuditEditorsService(params: ListAuditEditorsParams): Promise<AuditEditorsResult> {
  const { requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  const users = await getAuditEditors(scope.treeId);
  return { users };
}

export interface RevertAuditParams {
  ids: number[];
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** POST /api/audit/revert logic: check owner permission, validate ids array, then revert entries. */
export async function revertAuditService(
  params: RevertAuditParams
): Promise<{ success: true; revertedCount: number }> {
  const { ids, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to revert changes in this tree');
  }

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'number')) {
    throw new ValidationError('ids must be a non-empty array of numbers');
  }
  if (ids.length > 100) {
    throw new ValidationError('Cannot revert more than 100 entries at once');
  }

  try {
    if (ids.length === 1) {
      await revertAuditEntry(ids[0], scope.treeId, scope.ownerId, currentUserId);
      return { success: true, revertedCount: 1 };
    }

    const revertedCount = await revertAuditEntries(ids, scope.treeId, scope.ownerId, currentUserId);
    return { success: true, revertedCount };
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('not found') || err.message.includes('no longer exists'))
    ) {
      throw new NotFoundError(err.message);
    }
    throw err;
  }
}
