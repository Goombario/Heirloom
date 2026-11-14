import type { Audited } from '@/lib/db/queries/audit-capture';
import {
  getCitationsForPerson,
  getCitationsForFamily,
  getCaseCommentCitationContext,
  getCitationsForFact,
  createCitation,
  updateCitation,
  deleteCitation,
  CITED_RECORD_TABLE,
  sourceInTree,
  factIdsInTree,
  type Citation,
} from '@/lib/db/queries/citations';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { getCaseFindingStatus } from '@/lib/db/queries/case-workspace';
import { ValidationError } from '@/lib/validation';
import { query, getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import { FACT_TABLES, isFactTableValue, type FactTableValue } from '@/lib/db/fact-tables';
import { isQuayValue } from '@/lib/citations/quay';
import type { CreateCitationInput, CreateCitationsInput, UpdateCitationInput } from '@/lib/data/types';

/** Certainty (QUAY): a 0–3 string, or blank/none as null; anything else is rejected. */
function normalizeQuay(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isQuayValue(value)) {
    throw new ValidationError(`Invalid Quay: ${String(value)} (expected 0–3)`);
  }
  return value;
}

function trimmedOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Longer than any record link a site produces; it only bounds a runaway value. */
const MAX_URL_LENGTH = 4096;

/** A record link (ADR 0025): trimmed, blank as null. One line, since export writes it as a GEDCOM value. */
function normalizeUrl(value: unknown): string | null {
  const url = trimmedOrNull(value);
  if (url !== null && /[\x00-\x1f\x7f\x85\u2028\u2029]/.test(url)) {
    throw new ValidationError('Url must be a single line');
  }
  if (url !== null && url.length > MAX_URL_LENGTH) {
    throw new ValidationError(`Url must be at most ${MAX_URL_LENGTH} characters`);
  }
  return url;
}

export interface ListCitationsForPersonParams {
  personId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/citations?personId= logic: validate access, then return citations grouped by fact key. */
export async function listCitationsForPersonService(
  params: ListCitationsForPersonParams
): Promise<Record<string, Citation[]>> {
  const { personId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);

  const groups = await getCitationsForPerson(personId, scope.treeId);
  const citationMap: Record<string, Citation[]> = {};
  for (const { key, citations } of groups) {
    citationMap[key] = citations;
  }
  return citationMap;
}

export interface ListCitationsForFamilyParams {
  familyId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/citations?familyId= logic: return family + persisted family-event citations. */
export async function listCitationsForFamilyService(
  params: ListCitationsForFamilyParams
): Promise<Record<string, Citation[]>> {
  const { familyId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  const groups = await getCitationsForFamily(familyId, scope.treeId);
  return Object.fromEntries(groups.map(({ key, citations }) => [key, citations]));
}

export interface ListCitationsForFactParams {
  factTable: FactTableValue;
  factId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/citations?factTable=&factId= logic: validate access, then list citations for a specific fact. */
export async function listCitationsForFactService(
  params: ListCitationsForFactParams
): Promise<Citation[]> {
  const { factTable, factId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  return getCitationsForFact(factTable, factId, scope.treeId);
}

export interface CreateCitationParams {
  input: CreateCitationInput;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** POST /api/citations logic: check write permission, validate input, guard IDOR and closed cases, then create citation. */
export async function createCitationService(params: CreateCitationParams): Promise<Audited<Citation>> {
  const { input, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }

  if (!input.FactTable || !input.FactId || !input.SourceId) {
    throw new ValidationError('FactTable, FactId, and SourceId are required');
  }
  if (!isFactTableValue(input.FactTable)) {
    throw new ValidationError(`Invalid FactTable: ${input.FactTable}`);
  }

  const factTable: FactTableValue = input.FactTable;
  const sourceId = Number(input.SourceId);
  const factId = Number(input.FactId);
  if (!Number.isFinite(sourceId) || !Number.isFinite(factId)) {
    throw new ValidationError('SourceId and FactId must be integers');
  }

  // IDOR guard: verify the SourceId belongs to this tree.
  if (!(await sourceInTree(sourceId, scope.treeId))) {
    throw new NotFoundError('Source not found in this tree');
  }

  // IDOR guard: the cited FACT must also be in this tree, or the citation would
  // reference another (same-owner) tree's record. Cases is validated (with its
  // closed-status check) below; CaseComments has no TreeId of its own (scoped
  // transitively via its case) so it's covered there too.
  if (CITED_RECORD_TABLE[factTable] && !(await factIdsInTree(factTable, [factId], scope.treeId)).has(factId)) {
    throw new NotFoundError('Cited record not found in this tree');
  }

  const quay = normalizeQuay(input.Quay);
  const dataText = trimmedOrNull(input.DataText);
  const url = normalizeUrl(input.Url);

  // Closed-case guard. Cases is now TreeId-anchored (multi-tree cases slice), so
  // this reads by the resolved tree scope like every other cross-entity check.
  if (factTable === FACT_TABLES.CASES) {
    const caseCheck = await query(
      `SELECT "Status" FROM "Cases" WHERE "Id" = $1 AND "TreeId" = $2`,
      [factId, scope.treeId]
    );
    const caseRow = caseCheck.rows[0] as { Status: string } | undefined;
    if (!caseRow) {
      throw new NotFoundError('Case not found in this tree');
    }
    if (caseRow.Status === 'closed') {
      throw new AccessError('Cannot add citations to a closed case');
    }
  }
  if (factTable === FACT_TABLES.CASE_COMMENTS) {
    const context = await getCaseCommentCitationContext(factId, scope.treeId);
    if (!context) {
      throw new NotFoundError('Case comment not found in this tree');
    }
    if (context.status === 'closed') {
      throw new AccessError('Cannot add citations to a closed case');
    }
  }
  // A case finding (#58) is scoped through its case, like a journal entry.
  if (factTable === FACT_TABLES.CASE_FINDINGS) {
    const status = await getCaseFindingStatus(factId, scope.treeId);
    if (!status) throw new NotFoundError('Finding not found in this tree');
    if (status === 'closed') throw new AccessError('Cannot add citations to a closed case');
  }

  return createCitation(
    {
      OwnerId: scope.ownerId,
      TreeId: scope.treeId,
      FactTable: factTable,
      FactId: factId,
      SourceId: sourceId,
      Page: input.Page ?? null,
      Note: input.Note ?? null,
      Quay: quay,
      DataText: dataText,
      Url: url,
    },
    currentUserId
  );
}

export interface UpdateCitationParams {
  id: number;
  input: UpdateCitationInput;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** PUT /api/citations/[id] logic: check write permission, validate Quay, then update the citation's evidence fields. */
export async function updateCitationService(params: UpdateCitationParams): Promise<Audited<Citation>> {
  const { id, input, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }

  const quay = normalizeQuay(input.Quay);
  const dataText = trimmedOrNull(input.DataText);
  const page = trimmedOrNull(input.Page);
  // Undefined keeps the stored link (see updateCitation).
  const url = input.Url === undefined ? undefined : normalizeUrl(input.Url);

  const updated = await updateCitation(id, scope.treeId, { Page: page, Quay: quay, DataText: dataText, Url: url }, currentUserId);
  if (!updated) throw new NotFoundError('Citation not found');
  return updated;
}

export interface RemoveCitationParams {
  id: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** DELETE /api/citations/[id] logic: deletes need owner/edit ('contribute' blocks deletes, same as top-level entities). */
export async function removeCitationService(params: RemoveCitationParams): Promise<Audited> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }

  const { deleted, auditIds } = await deleteCitation(id, scope.treeId, currentUserId);
  if (!deleted) throw new NotFoundError('Citation not found');
  return { auditIds };
}

/** Facts a bulk cite may target: the person and family facts the source view offers. */
const BULK_FACT_TABLES: ReadonlySet<FactTableValue> = new Set<FactTableValue>([
  FACT_TABLES.PEOPLE,
  FACT_TABLES.PERSON_BIRTH,
  FACT_TABLES.PERSON_DEATH,
  FACT_TABLES.PERSON_NAME,
  FACT_TABLES.FAMILIES,
  FACT_TABLES.EVENTS,
  FACT_TABLES.NAME_VARIANT,
]);

/** A household is a handful of people; this only bounds a runaway request. */
const MAX_BULK_CITATIONS = 200;

export interface CreateCitationsParams {
  input: CreateCitationsInput;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * POST /api/citations/bulk logic (#799): cite one source on many facts. Every
 * fact is checked against the tree before any row is written, and the rows and
 * their audit entries commit in one transaction, so a failure leaves nothing.
 * A fact listed twice is cited once. Each fact's own Page overrides the shared one.
 */
export async function createCitationsService(params: CreateCitationsParams): Promise<Citation[]> {
  const { input, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }

  const sourceId = Number(input?.SourceId);
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    throw new ValidationError('SourceId must be a positive integer');
  }
  if (!Array.isArray(input.facts) || input.facts.length === 0) {
    throw new ValidationError('facts must be a non-empty array');
  }
  if (input.facts.length > MAX_BULK_CITATIONS) {
    throw new ValidationError(`At most ${MAX_BULK_CITATIONS} facts can be cited at once`);
  }
  const quay = normalizeQuay(input.Quay);
  const dataText = trimmedOrNull(input.DataText);
  const sharedPage = trimmedOrNull(input.Page);
  // Checked before anything is written: a bad link rejects the whole bulk cite (#41).
  const url = normalizeUrl(input.Url);

  const facts: { factTable: FactTableValue; factId: number; page: string | null }[] = [];
  const seen = new Set<string>();
  const idsByTable = new Map<FactTableValue, number[]>();
  for (const fact of input.facts) {
    const factTable: unknown = fact?.FactTable;
    if (!isFactTableValue(factTable) || !BULK_FACT_TABLES.has(factTable)) {
      throw new ValidationError(`Invalid FactTable: ${String(factTable)}`);
    }
    const factId = Number(fact.FactId);
    if (!Number.isInteger(factId) || factId <= 0) {
      throw new ValidationError('FactId must be a positive integer');
    }
    const key = `${factTable}:${factId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({ factTable, factId, page: trimmedOrNull(fact.Page) ?? sharedPage });
    idsByTable.set(factTable, [...(idsByTable.get(factTable) ?? []), factId]);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!(await sourceInTree(sourceId, scope.treeId, client))) {
      throw new NotFoundError('Source not found in this tree');
    }
    for (const [factTable, ids] of idsByTable) {
      const found = await factIdsInTree(factTable, ids, scope.treeId, client);
      if (ids.some(id => !found.has(id))) {
        throw new NotFoundError('Cited record not found in this tree');
      }
    }
    const created: Citation[] = [];
    for (const fact of facts) {
      created.push(await createCitation(
        {
          OwnerId: scope.ownerId,
          TreeId: scope.treeId,
          FactTable: fact.factTable,
          FactId: fact.factId,
          SourceId: sourceId,
          Page: fact.page,
          Quay: quay,
          DataText: dataText,
          Url: url,
        },
        currentUserId,
        client,
      ));
    }
    await client.query('COMMIT');
    return created;
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
}
