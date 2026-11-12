import { getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import {
  addClaim,
  caseInTree,
  decideClaim,
  getCaseWorkspace,
  insertFinding,
  insertLead,
  insertRequest,
  lockOpenCase,
  replyToRequest,
  setLeadState,
  updateLead,
  type ClaimInput,
  type FindingInput,
  type LeadInput,
  type RequestInput,
} from '@/lib/db/queries/case-workspace';
import type { Queryable } from '@/lib/db/queries/audit-capture';
import { validateStringField, ValidationError } from '@/lib/validation';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import type {
  CaseClaimDecision, CaseClaimEvidence, CaseInformation, CaseRequestSentBy, CaseRequestState, CaseSourceNature, CaseWorkspace,
} from '@/lib/db/schema';

/*
 * The research workspace's services (#58, ADR 0045). Every write runs in one
 * transaction that first locks the open case in the caller's tree, and answers
 * with the case's whole workspace so the page redraws from one read.
 */

export interface WorkspaceScopeParams {
  caseId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** A write's answer: the new row's id, when it made one, and the workspace after it. */
export interface WorkspaceWrite {
  id: number | null;
  workspace: CaseWorkspace;
}

const SHORT = 500;
const LONG = 10000;
const MAX_LIST = 200;
/** The largest id a Postgres integer column holds. */
const MAX_ID = 2147483647;

async function scopeFor(params: WorkspaceScopeParams, write: boolean) {
  const scope = await resolveTreeScope(
    { treeId: params.requestedTreeId, ownerId: params.requestedOwnerId },
    params.currentUserId,
  );
  if (write && scope.permission === 'view') throw new AccessError('You only have view permission for this tree');
  return scope;
}

/** Runs `work` in a transaction after locking the open case in the caller's tree. */
async function inCase(
  params: WorkspaceScopeParams,
  work: (exec: Queryable, scope: { treeId: number; ownerId: number }) => Promise<number | null>,
): Promise<WorkspaceWrite> {
  const scope = await scopeFor(params, true);
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await lockOpenCase(client, params.caseId, scope.treeId);
    const id = await work(client, { treeId: scope.treeId, ownerId: scope.ownerId });
    const workspace = await getCaseWorkspace(params.caseId, scope.treeId, client);
    await client.query('COMMIT');
    return { id, workspace };
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ─── Field checks ────────────────────────────────────────────────────────────

function text(value: unknown, field: string, max = SHORT): string | null {
  const s = validateStringField(value, field, max);
  const trimmed = s?.trim();
  return trimmed ? trimmed : null;
}

function required(value: unknown, field: string, max = SHORT): string {
  const s = text(value, field, max);
  if (!s) throw new ValidationError(`${field} is required`);
  return s;
}

function year(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new ValidationError(`${field} must be a year`);
  return n;
}

function years(fromValue: unknown, toValue: unknown): { fromYear: number | null; toYear: number | null } {
  const fromYear = year(fromValue, 'fromYear');
  const toYear = year(toValue, 'toYear');
  if (fromYear != null && toYear != null && fromYear > toYear) throw new ValidationError('The from year is after the to year');
  return { fromYear, toYear };
}

function id(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_ID) throw new ValidationError(`${field} must be an id`);
  return n;
}

function ids(value: unknown, field: string): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_LIST) throw new ValidationError(`${field} must be a list of ids`);
  return [...new Set(value.map((v) => id(v, field)).filter((n): n is number => n != null))];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function isoDate(value: unknown, field: string): string | null {
  const s = text(value, field, 10);
  if (s == null) return null;
  const time = Date.parse(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== s) {
    throw new ValidationError(`${field} must be a date (YYYY-MM-DD)`);
  }
  return s;
}

function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Request body must be an object');
  return value as Record<string, unknown>;
}

function leadInput(raw: Record<string, unknown>): LeadInput {
  return {
    question: required(raw.question, 'question'),
    ...years(raw.fromYear, raw.toYear),
    personIds: ids(raw.personIds, 'personIds'),
  };
}

const EVIDENCE: readonly CaseClaimEvidence[] = ['direct', 'indirect', 'negative'];

function claimInput(value: unknown): ClaimInput {
  const raw = body(value);
  const personId = id(raw.personId, 'personId');
  return {
    what: required(raw.what, 'what', 100),
    personId,
    personName: personId == null ? text(raw.personName, 'personName') : null,
    says: text(raw.says, 'says', LONG),
    date: text(raw.date, 'date', 100),
    place: text(raw.place, 'place'),
    evidence: oneOf(raw.evidence, EVIDENCE, 'evidence'),
  };
}

function findingInput(raw: Record<string, unknown>): FindingInput {
  const kind = oneOf(raw.kind, ['record', 'nothing'] as const, 'kind');
  if (!kind) throw new ValidationError('kind is required');
  const leadIds = ids(raw.leadIds, 'leadIds');
  if (kind === 'nothing') {
    return {
      kind, leadIds, source: null, page: null, url: null, transcription: null, mediaId: null,
      sourceNature: null, information: null,
      searched: required(raw.searched, 'searched'),
      site: text(raw.site, 'site'),
      note: text(raw.note, 'note', LONG),
      requestId: id(raw.requestId, 'requestId'),
      claims: [],
    };
  }
  let source: FindingInput['source'];
  const rawSource = raw.source == null ? null : body(raw.source);
  const sourceId = rawSource ? id(rawSource.id, 'source.id') : null;
  if (sourceId != null) source = { id: sourceId };
  else if (rawSource) source = { title: required(rawSource.title, 'source.title'), repository: text(rawSource.repository, 'source.repository') };
  else throw new ValidationError('A record needs its source');
  const claims = raw.claims == null ? [] : raw.claims;
  if (!Array.isArray(claims) || claims.length > MAX_LIST) throw new ValidationError('claims must be a list');
  return {
    kind, leadIds, source,
    page: text(raw.page, 'page'),
    url: text(raw.url, 'url', 2000),
    transcription: text(raw.transcription, 'transcription', LONG),
    mediaId: id(raw.mediaId, 'mediaId'),
    sourceNature: oneOf<CaseSourceNature>(raw.sourceNature, ['original', 'derivative', 'authored'], 'sourceNature'),
    information: oneOf<CaseInformation>(raw.information, ['primary', 'secondary', 'unknown'], 'information'),
    searched: null, site: null, note: text(raw.note, 'note', LONG),
    requestId: id(raw.requestId, 'requestId'),
    claims: claims.map(claimInput),
  };
}

function requestInput(raw: Record<string, unknown>): RequestInput {
  return {
    leadId: id(raw.leadId, 'leadId'),
    askedFor: required(raw.askedFor, 'askedFor'),
    holder: text(raw.holder, 'holder'),
    sentBy: oneOf<CaseRequestSentBy>(raw.sentBy, ['online', 'email', 'post', 'in_person'], 'sentBy'),
    sentOn: isoDate(raw.sentOn, 'sentOn'),
    reference: text(raw.reference, 'reference'),
    remindOn: isoDate(raw.remindOn, 'remindOn'),
  };
}

// ─── Services ────────────────────────────────────────────────────────────────

/** GET /api/cases/[id]/workspace: the case's leads, findings and requests. */
export async function getCaseWorkspaceService(params: WorkspaceScopeParams): Promise<CaseWorkspace> {
  const scope = await scopeFor(params, false);
  if (!(await caseInTree(params.caseId, scope.treeId))) throw new NotFoundError('Case not found');
  return getCaseWorkspace(params.caseId, scope.treeId);
}

/** POST /api/cases/[id]/leads: a new lead at the end of the list. */
export async function addLeadService(params: WorkspaceScopeParams & { body: unknown }): Promise<WorkspaceWrite> {
  const input = leadInput(body(params.body));
  return inCase(params, (exec, scope) => insertLead(exec, params.caseId, scope.treeId, input, params.currentUserId));
}

/** PATCH /api/cases/[id]/leads/[leadId]: edit, settle, reopen or drop a lead. */
export async function changeLeadService(params: WorkspaceScopeParams & { leadId: number; body: unknown }): Promise<WorkspaceWrite> {
  const raw = body(params.body);
  const action = oneOf(raw.action, ['edit', 'settle', 'reopen', 'drop'] as const, 'action');
  if (!action) throw new ValidationError('action is required');
  const input = action === 'edit' ? leadInput(raw) : null;
  return inCase(params, async (exec, scope) => {
    if (input) await updateLead(exec, params.caseId, scope.treeId, params.leadId, input);
    else await setLeadState(exec, params.caseId, scope.treeId, params.leadId, action as 'settle' | 'reopen' | 'drop', params.currentUserId);
    return null;
  });
}

/** POST /api/cases/[id]/findings: a record with its source and claims, or a search that found nothing. */
export async function addFindingService(params: WorkspaceScopeParams & { body: unknown }): Promise<WorkspaceWrite> {
  const input = findingInput(body(params.body));
  return inCase(params, (exec, scope) => insertFinding(exec, params.caseId, scope.treeId, scope.ownerId, params.currentUserId, input));
}

/** POST /api/cases/[id]/findings/[findingId]/claims: one more claim on a record. */
export async function addClaimService(params: WorkspaceScopeParams & { findingId: number; body: unknown }): Promise<WorkspaceWrite> {
  const claim = claimInput(params.body);
  return inCase(params, async (exec, scope) => {
    await addClaim(exec, params.caseId, scope.treeId, params.findingId, claim);
    return null;
  });
}

/** PATCH /api/cases/[id]/claims/[claimId]: accept, reject or undecide a claim. */
export async function decideClaimService(params: WorkspaceScopeParams & { claimId: number; body: unknown }): Promise<WorkspaceWrite> {
  const decision = oneOf<CaseClaimDecision>(body(params.body).decision, ['accepted', 'rejected', 'undecided'], 'decision');
  if (!decision) throw new ValidationError('decision is required');
  return inCase(params, async (exec) => {
    await decideClaim(exec, params.caseId, params.claimId, decision, params.currentUserId);
    return null;
  });
}

/** POST /api/cases/[id]/requests: start tracking a record asked for. */
export async function addRequestService(params: WorkspaceScopeParams & { body: unknown }): Promise<WorkspaceWrite> {
  const input = requestInput(body(params.body));
  return inCase(params, (exec) => insertRequest(exec, params.caseId, input, params.currentUserId));
}

/** PATCH /api/cases/[id]/requests/[requestId]: log the reply to a request. */
export async function replyToRequestService(params: WorkspaceScopeParams & { requestId: number; body: unknown }): Promise<WorkspaceWrite> {
  const raw = body(params.body);
  const state = oneOf<CaseRequestState>(raw.state, ['waiting', 'received', 'nothing'], 'state');
  if (!state) throw new ValidationError('state is required');
  const note = text(raw.note, 'note', LONG);
  return inCase(params, async (exec) => {
    await replyToRequest(exec, params.caseId, params.requestId, state, note, params.currentUserId);
    return null;
  });
}
