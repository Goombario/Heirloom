import { parseIdParam } from '@/lib/utils/parse-id';
import { getAuditLog, getAuditEditors, getAuditRefNames, revertAuditEntry, revertAuditEntries, withoutEditorEmails } from '@/lib/db/queries/audit';
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

/** A real YYYY-MM-DD calendar day (2026-02-30 is not one). */
function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** GET /api/audit logic: validate access, clamp pagination, then list entries. */
export async function listAuditService(params: ListAuditParams): Promise<AuditListResult> {
  const { requestedTreeId, requestedOwnerId, currentUserId, page = 1, pageSize = 50 } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );

  // Non-numeric paging or an unreadable date reached SQL and failed there as a
  // 500 (#51, L-1); it is bad input, so it's a 400.
  if (!Number.isInteger(page) || !Number.isInteger(pageSize)) {
    throw new ValidationError('page and pageSize must be whole numbers');
  }
  for (const [name, value] of [['dateFrom', params.dateFrom], ['dateTo', params.dateTo]] as const) {
    if (value !== undefined && !isCalendarDate(value)) throw new ValidationError(`${name} must be a date (YYYY-MM-DD)`);
  }
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
    // View-only members see editors' display names, never their emails (#51, L-4).
    const shown = scope.permission === 'view' ? withoutEditorEmails(entries) : entries;
    return { entries: shown, total, page: clampedPage, pageSize: clampedPageSize, refs, records };
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

  // Whole positive ids only: 1.5 or 1e12 reached SQL and failed there (#51, L-1).
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'number' && parseIdParam(id) !== null)) {
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
