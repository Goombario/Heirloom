import {
  getAllCases,
  getCaseById,
  createCase,
  updateCase,
  deleteCase,
  addComment,
  getCaseNote,
  setCaseNoteStrike,
  type CaseNoteStrike,
  getMediaForCaseLinkedPeople,
  linkMedia,
  unlinkOrDeleteCaseMedia,
} from '@/lib/db/queries/cases';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { query, getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import { auditCaseNoteStrike, withAuditIds, type Audited } from '@/lib/db/queries/audit-capture';
import { validateStringField, ValidationError } from '@/lib/validation';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import type { Case, CaseComment, CaseWithRelations, MediaWithPerson, NewCase } from '@/lib/db/schema';

// ── Param types ───────────────────────────────────────────────────────────────

export interface ListCasesParams {
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
  status?: string;
  tag?: string;
  search?: string;
  personId?: number;
}

export interface GetCaseParams {
  id: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

export interface CreateCaseParams {
  body: Record<string, unknown>;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

export interface UpdateCaseParams {
  id: number;
  body: Record<string, unknown>;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

export interface DeleteCaseParams {
  id: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

export interface AddCommentParams {
  id: number;
  body: string;
  mediaId?: number | null;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

export interface ListMediaLibraryParams {
  id: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

export interface LinkMediaParams {
  id: number;
  mediaIds: number[];
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

export interface UnlinkMediaParams {
  id: number;
  mediaId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set(['in_progress', 'on_hold', 'closed']);

/** Map plain Error strings from case query fns to typed errors. */
function mapCaseError(err: unknown): never | void {
  if (!(err instanceof Error)) return;
  if (err.message === 'Case not found') throw new NotFoundError('Case not found');
  if (err.message.startsWith('Permission denied')) throw new AccessError(err.message);
  if (err.message === 'Conclusion required') throw new ValidationError('A conclusion is required to close a case');
}

// ── Service functions ─────────────────────────────────────────────────────────

/** GET /api/cases logic: validate access then list cases with optional filters. */
export async function listCasesService(
  params: ListCasesParams
): Promise<{ cases: CaseWithRelations[]; count: number }> {
  const { requestedTreeId, requestedOwnerId, currentUserId, status, tag, search, personId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  const cases = await getAllCases(scope.treeId, { status, tag, search, personId });
  return { cases, count: cases.length };
}

/** GET /api/cases/[id] logic: validate access then return a single case with relations. */
export async function getCaseService(params: GetCaseParams): Promise<CaseWithRelations> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  const caseRecord = await getCaseById(id, scope.treeId);
  if (!caseRecord) throw new NotFoundError('Case not found');
  return caseRecord;
}

/** POST /api/cases logic: validate access, validate inputs, then create a case. */
export async function createCaseService(params: CreateCaseParams): Promise<Case> {
  const { body, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const title = validateStringField(body.Title, 'Title', 500);
  if (!title) throw new ValidationError('Title is required');

  type CaseStatus = 'in_progress' | 'on_hold' | 'closed';
  const status: CaseStatus = VALID_STATUSES.has(body.Status as string)
    ? (body.Status as CaseStatus)
    : 'in_progress';

  const tags: string[] = Array.isArray(body.Tags)
    ? body.Tags.map((t: unknown) => String(t).slice(0, 100)).filter(Boolean)
    : [];

  const newCase: NewCase = {
    UserId: scope.ownerId, // legacy owner column: the TREE's owner (unchanged semantics for shared contributors)
    TreeId: scope.treeId,
    Title: title,
    Description: validateStringField(body.Description, 'Description', 10000),
    Status: status,
    Tags: tags,
  };

  const personIds: number[] = Array.isArray(body.personIds)
    ? body.personIds.map((id: unknown) => parseInt(String(id), 10)).filter((n: number) => !isNaN(n))
    : [];

  return createCase(newCase, personIds, currentUserId);
}

/** PUT /api/cases/[id] logic: validate access, validate inputs, then update a case. */
export async function updateCaseService(params: UpdateCaseParams): Promise<Case> {
  const { id, body, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const updates: Record<string, unknown> = {};
  if (body.Title !== undefined) {
    const title = validateStringField(body.Title, 'Title', 500);
    if (!title) throw new ValidationError('Title is required');
    updates.Title = title;
  }
  if (body.Description !== undefined) {
    updates.Description = validateStringField(body.Description, 'Description', 10000);
  }
  if (body.Status !== undefined) {
    if (!VALID_STATUSES.has(body.Status as string)) {
      throw new ValidationError('Invalid status value');
    }
    updates.Status = body.Status;
  }
  if (body.Tags !== undefined) {
    updates.Tags = Array.isArray(body.Tags)
      ? body.Tags.map((t: unknown) => String(t).slice(0, 100)).filter(Boolean)
      : [];
  }

  const personIds: number[] = Array.isArray(body.personIds)
    ? body.personIds.map((pid: unknown) => parseInt(String(pid), 10)).filter((n: number) => !isNaN(n))
    : [];

  const mediaIds: number[] = Array.isArray(body.mediaIds)
    ? body.mediaIds.map((mid: unknown) => parseInt(String(mid), 10)).filter((n: number) => !isNaN(n))
    : [];

  // Closing an open case needs a conclusion (#801); updateCase rejects it without one.
  const conclusion = body.Conclusion !== undefined
    ? validateStringField(body.Conclusion, 'Conclusion', 10000)
    : null;

  try {
    return await updateCase(id, updates, personIds, mediaIds, scope.treeId, currentUserId, conclusion?.trim() || null);
  } catch (err) {
    mapCaseError(err);
    throw err;
  }
}

/** DELETE /api/cases/[id] logic: validate access, then delete a case. */
export async function deleteCaseService(params: DeleteCaseParams): Promise<void> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }
  try {
    const deleted = await deleteCase(id, scope.treeId, currentUserId);
    if (!deleted) throw new NotFoundError('Case not found');
  } catch (err) {
    mapCaseError(err);
    throw err;
  }
}

/** POST /api/cases/[id]/comments logic: check case exists and is open, then add a comment. */
export async function addCommentService(params: AddCommentParams): Promise<CaseComment> {
  const { id, body, mediaId = null, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const caseRecord = await getCaseById(id, scope.treeId);
  if (!caseRecord) throw new NotFoundError('Case not found');
  if (caseRecord.Status === 'closed') throw new AccessError('Cannot modify a closed case');

  if (!body) throw new ValidationError('Comment body is required');
  const bodyText = validateStringField(body, 'body', 10000);
  if (!bodyText) throw new ValidationError('Comment body is required');

  // CaseComments.UserId is the comment AUTHOR (the acting user), not tree scope —
  // it stays keyed on currentUserId, never scope.ownerId.
  return addComment(id, currentUserId, bodyText, mediaId);
}

export interface CaseNoteParams {
  caseId: number;
  commentId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** The longest strike-out reason: one line (#1251). */
const STRIKE_REASON_MAX = 500;

/**
 * Who may strike a journal note out or undo its strike (#1251, ADR 0042): the
 * note's author with Contribute access, and anyone with Edit access or the owner.
 * Viewers can't. Status and conclusion entries are the case's history and can't
 * be struck (getCaseNote never returns them). A closed case's journal is read-only,
 * as for adding.
 */
async function caseNoteForStrike(params: CaseNoteParams) {
  const scope = await resolveTreeScope(
    { treeId: params.requestedTreeId, ownerId: params.requestedOwnerId },
    params.currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');
  const note = await getCaseNote({ query }, scope.treeId, params.caseId, params.commentId);
  if (!note) throw new NotFoundError('Journal note not found');
  if (scope.permission === 'contribute' && note.UserId !== params.currentUserId) {
    throw new AccessError('You can only strike out your own journal notes');
  }
  if (note.CaseStatus === 'closed') throw new AccessError('Cannot modify a closed case');
  return scope;
}

async function changeStrike(params: CaseNoteParams, reason: string | null, strike: boolean): Promise<Audited<CaseNoteStrike>> {
  const scope = await caseNoteForStrike(params);
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const changed = await setCaseNoteStrike(client, scope.treeId, params.caseId, params.commentId,
      strike ? { at: null, by: params.currentUserId, reason } : null);
    const auditId = await auditCaseNoteStrike(changed, scope.ownerId, params.currentUserId, client);
    await client.query('COMMIT');
    const { StruckAt, StruckBy, StruckReason } = changed;
    return withAuditIds({ StruckAt, StruckBy, StruckReason }, [auditId]);
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * POST /api/cases/[id]/comments/[commentId]/strike logic: strike a note out as no
 * longer accurate, with an optional one-line reason, audited (#1251). The note's
 * text, photo and citations stay as written.
 */
export async function strikeCaseNoteService(params: CaseNoteParams & { reason?: unknown }): Promise<Audited<CaseNoteStrike>> {
  if (params.reason != null && typeof params.reason !== 'string') throw new ValidationError('Reason must be text');
  const oneLine = typeof params.reason === 'string' ? params.reason.replace(/\s+/g, ' ').trim() : '';
  const reason = oneLine ? validateStringField(oneLine, 'reason', STRIKE_REASON_MAX) : null;
  return changeStrike(params, reason || null, true);
}

/** DELETE /api/cases/[id]/comments/[commentId]/strike logic: undo a strike, audited (#1251). */
export async function unstrikeCaseNoteService(params: CaseNoteParams): Promise<Audited<CaseNoteStrike>> {
  return changeStrike(params, null, false);
}

/** GET /api/cases/[id]/media/library logic: validate access, check case exists, return library media. */
export async function listMediaLibraryService(params: ListMediaLibraryParams): Promise<MediaWithPerson[]> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );

  const caseRecord = await getCaseById(id, scope.treeId);
  if (!caseRecord) throw new NotFoundError('Case not found');

  return getMediaForCaseLinkedPeople(id, scope.treeId);
}

/** POST /api/cases/[id]/media logic: check case exists and is open, then link media. */
export async function linkMediaService(params: LinkMediaParams): Promise<{ linked: number }> {
  const { id, mediaIds, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const caseRecord = await getCaseById(id, scope.treeId);
  if (!caseRecord) throw new NotFoundError('Case not found');
  if (caseRecord.Status === 'closed') throw new AccessError('Cannot modify a closed case');

  if (mediaIds.length === 0) throw new ValidationError('mediaIds must be a non-empty array');

  await linkMedia(id, mediaIds, scope.treeId);
  return { linked: mediaIds.length };
}

/**
 * DELETE /api/cases/[id]/media/[mediaId] logic: check case exists and is open, then unlink/delete media.
 * Returns 'deleted' | 'unlinked' so the route can perform server-side file cleanup on 'deleted'.
 */
export async function unlinkMediaService(
  params: UnlinkMediaParams
): Promise<'deleted' | 'unlinked'> {
  const { id, mediaId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }

  const caseRecord = await getCaseById(id, scope.treeId);
  if (!caseRecord) throw new NotFoundError('Case not found');
  if (caseRecord.Status === 'closed') throw new AccessError('Cannot modify a closed case');

  const result = await unlinkOrDeleteCaseMedia(id, mediaId, scope.treeId);
  if (result === null) throw new NotFoundError('Media not found');
  return result;
}
