import { getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { withAuditIds, type Audited } from '@/lib/db/queries/audit-capture';
import {
  auditPersonMerge, differingFields, findMergeBlock, mergePeople, readMergeSide, MERGE_FIELDS,
  type MergeBlock, type MergeField, type MergeSide, type MergeTake,
} from '@/lib/db/queries/person-merge';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';

/** The two people side by side, what differs, and whether they can be merged (#28). */
export interface MergePreview {
  a: MergeSide;
  b: MergeSide;
  differing: MergeField[];
  blocked: MergeBlock | null;
}

interface PairParams {
  aId: number;
  bId: number;
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

function checkPair(aId: number, bId: number): void {
  if (!Number.isSafeInteger(aId) || aId <= 0 || !Number.isSafeInteger(bId) || bId <= 0) throw new ValidationError('Two person ids are required');
  if (aId === bId) throw new ValidationError('Pick two different people');
}

/** A merge rewrites many records at once, so it needs edit permission (ADR 0052). */
async function mergeScope(params: PairParams) {
  const scope = await resolveTreeScope({ treeId: params.requestedTreeId, ownerId: params.requestedOwnerId }, params.currentUserId);
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('Merging people needs edit permission for this tree');
  }
  return scope;
}

/** GET /api/people/merge logic: both people as the merge dialog shows them. */
export async function previewMergeService(params: PairParams): Promise<MergePreview> {
  checkPair(params.aId, params.bId);
  const scope = await mergeScope(params);
  const client = await getClient();
  try {
    const a = await readMergeSide(client, scope.treeId, params.aId);
    const b = await readMergeSide(client, scope.treeId, params.bId);
    if (!a || !b) throw new NotFoundError('Person not found');
    const differing = differingFields(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>);
    return { a, b, differing, blocked: await findMergeBlock(client, scope.treeId, params.aId, params.bId) };
  } finally {
    client.release();
  }
}

export interface MergePeopleParams {
  keptId: number;
  otherId: number;
  /** Per differing field, which person's value to keep; the kept person's by default. */
  take?: unknown;
  requestedTreeId?: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

function parseTake(value: unknown): MergeTake {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('take must be an object');
  const take: MergeTake = {};
  for (const [field, side] of Object.entries(value as Record<string, unknown>)) {
    if (!(MERGE_FIELDS as readonly string[]).includes(field)) throw new ValidationError(`Unknown field ${field}`);
    if (side !== 'kept' && side !== 'other') throw new ValidationError(`${field} must be "kept" or "other"`);
    take[field as MergeField] = side;
  }
  return take;
}

/**
 * POST /api/people/merge logic: merge `otherId` into `keptId` in one transaction
 * with one revertible audit entry (ADR 0052).
 */
export async function mergePeopleService(params: MergePeopleParams): Promise<Audited<{ keptId: number }>> {
  checkPair(params.keptId, params.otherId);
  const take = parseTake(params.take);
  const scope = await mergeScope({ ...params, aId: params.keptId, bId: params.otherId });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (await findMergeBlock(client, scope.treeId, params.keptId, params.otherId)) {
      throw new ValidationError('These two people are partners in the same family, or one is the other\'s parent, so they can\'t be merged');
    }
    const found = await client.query(`SELECT COUNT(*)::int AS n FROM "People" WHERE "Id" = ANY($1::int[]) AND "TreeId" = $2`, [[params.keptId, params.otherId], scope.treeId]);
    if ((found.rows[0] as { n: number }).n !== 2) throw new NotFoundError('Person not found');
    const snapshot = await mergePeople(client, scope.treeId, scope.ownerId, params.keptId, params.otherId, take);
    const auditId = await auditPersonMerge(client, scope.treeId, scope.ownerId, params.currentUserId, snapshot);
    await client.query('COMMIT');
    return withAuditIds({ keptId: params.keptId }, [auditId]);
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}
