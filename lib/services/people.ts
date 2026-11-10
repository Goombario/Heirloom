import {
  getAllPeople,
  createPerson,
  searchPeople,
  getPeopleCount,
  getPersonWithRelations,
  updatePerson,
  deletePerson,
  suggestSpousesForPerson,
  countDescendantsOfPerson,
  personExistsInTree,
  getPersonById,
  type PersonWithParentFamily,
} from '@/lib/db/queries/people';
import { suggestFamiliesForPerson } from '@/lib/db/queries/families';
import { safeRollback } from '@/lib/db/rollback';
import { scoreSuggestions } from '@/lib/family-suggestions';
import { validateStringField, validateDateField, validateNameField, validatePlaceIdField, validateSexField, ValidationError } from '@/lib/validation';
import type { FactPlacePick } from '@/lib/db/queries/place-links';
import { sortableYear } from '@/lib/date-utils';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { query, getClient } from '@/lib/db/connection';
import { auditCreate, auditUpdate, auditDelete, withAuditIds, type Audited } from '@/lib/db/queries/audit-capture';
import type { NewPerson, Person, PersonWithRelations } from '@/lib/db/schema';
import type { NameVariant, CreateNameVariantInput, FamilySuggestion } from '@/lib/data/types';
import { getLikelyDuplicates, type PeopleFlag } from '@/lib/db/queries/data-quality';

export interface ListPeopleParams {
  /** Tree requested via ?treeId, or null. */
  requestedTreeId: number | null;
  /** Legacy ?ownerId (deep-link compat): that user's default tree. */
  requestedOwnerId: number | null;
  currentUserId: number;
  /** Optional name search; when present, matches the old ?q= behavior. */
  search?: string | null;
}

export interface ListPeopleResult {
  people: PersonWithParentFamily[];
  count: number;
}

/** GET /api/people logic: validate access, then list or search. */
export async function listPeopleService(
  params: ListPeopleParams
): Promise<ListPeopleResult> {
  const { requestedTreeId, requestedOwnerId, currentUserId, search } = params;

  // Throws AccessError when the user can't view this tree.
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );

  if (search) {
    // searchPeople returns PersonResult (a subset). Cast matches pre-existing
    // API behavior: search results lack parent/family fields, which are optional
    // on PersonWithParentFamily, so callers already handle them as undefined.
    const people = await searchPeople(search, scope.treeId) as PersonWithParentFamily[];
    return { people, count: people.length };
  }

  const people = await getAllPeople(scope.treeId);
  const count = await getPeopleCount(scope.treeId);
  return { people, count };
}

export interface CreatePersonParams {
  body: Record<string, unknown>;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** POST /api/people logic: validate access + input, then create. */
export async function createPersonService(
  params: CreatePersonParams
): Promise<Audited<Person>> {
  const { body, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }

  const firstName = validateNameField(body.FirstName, 'FirstName', 200);
  const lastName = validateNameField(body.LastName, 'LastName', 200);
  if (!firstName && !lastName) {
    throw new ValidationError('At least FirstName or LastName is required');
  }

  // IsDeceased must be null, 0, or 1.
  const isDeceased =
    body.IsDeceased === null || body.IsDeceased === undefined
      ? null
      : body.IsDeceased === 1 || body.IsDeceased === 0
        ? (body.IsDeceased as number)
        : null;

  const newPersonData: NewPerson = {
    UserId: scope.ownerId, // legacy owner column: the TREE's owner (unchanged semantics for shared contributors)
    TreeId: scope.treeId,
    FirstName: firstName,
    LastName: lastName,
    Sex: validateSexField(body.Sex),
    // Never client-writable: merge import nominates match candidates by it (#871).
    GedcomId: null,
    BirthDate: validateDateField(body.BirthDate, 'BirthDate', 100),
    BirthPlace: validateNameField(body.BirthPlace, 'BirthPlace', 500),
    DeathDate: validateDateField(body.DeathDate, 'DeathDate', 100),
    DeathPlace: validateNameField(body.DeathPlace, 'DeathPlace', 500),
    DeathCause: validateStringField(body.DeathCause, 'DeathCause', 1000),
    IsDeceased: isDeceased,
    // No `Notes`: the column is gone (#524 / ADR 0010). A `Notes` key in the
    // body is ignored rather than 400'd — an older client posting one still
    // creates the person, and the note is written via POST /api/notes.
  };

  return createPerson(newPersonData, currentUserId, personPlacePicks(body));
}

/** The places a form picked for the birth and death place, by id (#1186). */
function personPlacePicks(body: Record<string, unknown>): FactPlacePick[] {
  const picks: FactPlacePick[] = [];
  const birth = validatePlaceIdField(body.BirthPlaceId, 'BirthPlaceId');
  const death = validatePlaceIdField(body.DeathPlaceId, 'DeathPlaceId');
  if (birth != null) picks.push({ kind: 'birth', placeId: birth });
  if (death != null) picks.push({ kind: 'death', placeId: death });
  return picks;
}

export interface GetPersonParams {
  id: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/people/[id] logic: validate access, then fetch with relations. */
export async function getPersonService(params: GetPersonParams): Promise<PersonWithRelations> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  const person = await getPersonWithRelations(id, scope.treeId);
  if (!person) throw new NotFoundError('Person not found');
  return person;
}

export interface UpdatePersonParams {
  id: number;
  body: Record<string, unknown>;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** PUT /api/people/[id] logic: access-check, validate present fields, update. */
export async function updatePersonService(params: UpdatePersonParams): Promise<Audited<Person>> {
  const { id, body, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }

  // Names and places are checked against the stored row: an imported value may
  // exceed the API cap, and an update can't leave the person with no name (#884).
  const touchesNames = ['FirstName', 'LastName', 'BirthPlace', 'DeathPlace'].some((f) => body[f] !== undefined);
  const stored = touchesNames ? await getPersonById(id, scope.treeId) : null;
  if (touchesNames && !stored) throw new NotFoundError('Person not found');

  const updateData: Partial<NewPerson> = {};
  if (body.FirstName !== undefined) updateData.FirstName = validateNameField(body.FirstName, 'FirstName', 200, stored?.FirstName);
  if (body.LastName !== undefined) updateData.LastName = validateNameField(body.LastName, 'LastName', 200, stored?.LastName);
  if (stored && !(updateData.FirstName !== undefined ? updateData.FirstName : stored.FirstName)
    && !(updateData.LastName !== undefined ? updateData.LastName : stored.LastName)) {
    throw new ValidationError('At least FirstName or LastName is required');
  }
  if (body.Sex !== undefined) updateData.Sex = validateSexField(body.Sex);
  if (body.BirthDate !== undefined) updateData.BirthDate = validateDateField(body.BirthDate, 'BirthDate', 100);
  if (body.BirthPlace !== undefined) updateData.BirthPlace = validateNameField(body.BirthPlace, 'BirthPlace', 500, stored?.BirthPlace);
  if (body.DeathDate !== undefined) updateData.DeathDate = validateDateField(body.DeathDate, 'DeathDate', 100);
  if (body.DeathPlace !== undefined) updateData.DeathPlace = validateNameField(body.DeathPlace, 'DeathPlace', 500, stored?.DeathPlace);
  if (body.DeathCause !== undefined) updateData.DeathCause = validateStringField(body.DeathCause, 'DeathCause', 1000);
  if (body.IsDeceased !== undefined) {
    updateData.IsDeceased = body.IsDeceased === 1 || body.IsDeceased === 0 ? (body.IsDeceased as number) : null;
  }
  // `Notes` is deliberately not handled: the column is gone (#524 / ADR 0010).
  // Before, updatePerson's ALLOWED_PERSON_FIELDS filter dropped it silently.

  // updatePerson throws NotFoundError for a missing/wrong-tree row — left to
  // propagate so handleApiError maps it to 404.
  return updatePerson(id, updateData, scope.treeId, currentUserId, personPlacePicks(body));
}

export interface DeletePersonParams {
  id: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** DELETE /api/people/[id] logic: only the tree owner (edit) may delete. */
export async function deletePersonService(params: DeletePersonParams): Promise<void> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }

  const success = await deletePerson(id, scope.treeId, currentUserId);
  if (!success) throw new NotFoundError('Person not found');
}

export interface SearchPeopleParams {
  q: string;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
  /** Already clamped by the caller; defaults to 10. */
  limit?: number;
  /** Also match the birthplace (global search, #1128). */
  places?: boolean;
}

/** GET /api/people/search logic: validate access, then search (limit pre-clamped). */
export async function searchPeopleService(
  params: SearchPeopleParams
): Promise<PersonWithParentFamily[]> {
  const { q, requestedTreeId, requestedOwnerId, currentUserId, limit = 10, places = false } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  // searchPeople returns PersonResult (a subset); cast matches existing API
  // behaviour (parent/family fields are optional on PersonWithParentFamily).
  return (await searchPeople(q, scope.treeId, limit, { places })) as PersonWithParentFamily[];
}

export interface ListFlaggedPeopleParams {
  flag: PeopleFlag;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * GET /api/people/flagged logic: the people behind a home suggestion (#794),
 * as groups of likely matches (#822). View permission is sufficient.
 */
export async function listFlaggedPeopleService(params: ListFlaggedPeopleParams): Promise<number[][]> {
  const { requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  // 'duplicates' is the only flag since #834 removed the no-events suggestion.
  return (await getLikelyDuplicates(scope.treeId)).groups;
}

const NAME_VARIANT_ALLOWED_TYPES = new Set(['Given', 'Nickname', 'Maiden', 'Married', 'Anglicized', 'Alias']);

export interface ListNameVariantsParams {
  personId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/people/[id]/name-variants logic. View permission is sufficient. */
export async function listNameVariantsService(
  params: ListNameVariantsParams
): Promise<NameVariant[]> {
  const { personId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );

  // The person must exist in the resolved tree. Without this the endpoint returns an
  // empty list for a person that is simply gone, so the UI renders a normal-looking
  // "no nicknames" panel and only fails when you try to add one — createNameVariantService
  // has always had this guard, so the read and write paths disagreed. A page left open
  // across a GEDCOM overwrite import hits exactly that, because overwrite wipes and
  // re-inserts people with fresh ids.
  const personCheck = await query(
    `SELECT 1 FROM "People" WHERE "Id" = $1 AND "TreeId" = $2`,
    [personId, scope.treeId]
  );
  if (personCheck.rowCount === 0) throw new NotFoundError('Person not found in this tree');

  const result = await query(
    `SELECT "Id", "PersonId", "Type", "Name", "FromDate", "ToDate", "IsPrimary"
     FROM "NameVariant"
     WHERE "PersonId" = $1 AND "TreeId" = $2
     ORDER BY "Id"`,
    [personId, scope.treeId]
  );
  return result.rows as NameVariant[];
}

export interface CreateNameVariantParams {
  personId: number;
  body: CreateNameVariantInput;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** POST /api/people/[id]/name-variants logic. Audit capture runs inline. */
export async function createNameVariantService(
  params: CreateNameVariantParams
): Promise<Audited<NameVariant>> {
  const { personId, body, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('View-only access');

  // IDOR guard: the person must belong to the resolved tree.
  const personCheck = await query(
    `SELECT 1 FROM "People" WHERE "Id" = $1 AND "TreeId" = $2`,
    [personId, scope.treeId]
  );
  if (personCheck.rowCount === 0) throw new NotFoundError('Person not found in this tree');

  const type = body.Type ?? 'Alias';
  if (!NAME_VARIANT_ALLOWED_TYPES.has(type)) throw new ValidationError(`Invalid type: ${type}`);
  const name = validateNameField(body.Name, 'Name', 200);
  if (!name) throw new ValidationError('Name is required');
  const fromDate = body.FromDate ? validateDateField(body.FromDate, 'FromDate', 100) : null;
  const toDate = body.ToDate ? validateDateField(body.ToDate, 'ToDate', 100) : null;

  // A person's FIRST nickname becomes their preferred name (#436). Adding one used
  // to change nothing visible anywhere: display keys off "IsPrimary" and no write
  // path ever set it, which is the exact failure ADR 0001 records — and its
  // resolution is to SET the flag on the write paths, never to relax the display
  // rule. This is that side of it.
  //
  // Only the first, and only a nickname:
  //  - A person who already HAS a preferred name made that choice explicitly (or
  //    had it promoted here); a later addition must not silently demote it.
  //  - Only nicknames. A maiden or anglicized name is a name the person was ALSO
  //    known by, not the one to render them under; promoting one would rewrite the
  //    displayed name of everyone whose first recorded variant happens to be a
  //    maiden name.
  //
  // Decided inside the INSERT rather than by a read-then-write, so two concurrent
  // adds cannot both see "no primary yet" and race into a partial-unique-index
  // violation on idx_namevariant_one_primary.
  const promoteIfFirst = type === 'Nickname';
  const result = await query(
    `INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name", "FromDate", "ToDate", "IsPrimary")
     SELECT $1, $2, $3, $4, $5, $6, $7,
            CASE WHEN $8::boolean AND NOT EXISTS (
              SELECT 1 FROM "NameVariant"
              WHERE "PersonId" = $3 AND "TreeId" = $2 AND "IsPrimary" = 1
            ) THEN 1 ELSE 0 END
     RETURNING "Id", "PersonId", "Type", "Name", "FromDate", "ToDate", "IsPrimary", "TreeId"`,
    [scope.ownerId, scope.treeId, personId, type, name, fromDate, toDate, promoteIfFirst]
  );
  const variant = result.rows[0] as Record<string, unknown>;
  const auditId = await auditCreate('namevariant', variant, scope.ownerId, currentUserId);
  return withAuditIds(result.rows[0] as NameVariant, [auditId]);
}

const NAME_VARIANT_FIELDS: ReadonlySet<string> = new Set(['Type', 'Name', 'FromDate', 'ToDate', 'IsPrimary']);

export interface SetPrimaryNameVariantParams {
  personId: number;
  variantId: number;
  isPrimary: boolean;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * PATCH logic: set/clear this variant as the person's primary, in a transaction
 * so the partial unique index is never violated mid-update. Returns the updated
 * variant row (the route discards it and returns { success: true }).
 */
export async function setPrimaryNameVariantService(
  params: SetPrimaryNameVariantParams
): Promise<Audited<NameVariant>> {
  const { personId, variantId, isPrimary, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('View-only access');
  const treeId = scope.treeId;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const beforeRes = await client.query(
      `SELECT * FROM "NameVariant" WHERE "PersonId" = $1 AND "TreeId" = $2 AND ("IsPrimary" = 1 OR "Id" = $3)`,
      [personId, treeId, variantId]
    );
    const beforeRows = beforeRes.rows as Record<string, unknown>[];

    await client.query(
      `UPDATE "NameVariant" SET "IsPrimary" = 0 WHERE "PersonId" = $1 AND "TreeId" = $2 AND "IsPrimary" = 1`,
      [personId, treeId]
    );
    if (isPrimary) {
      const res = await client.query(
        `UPDATE "NameVariant" SET "IsPrimary" = 1 WHERE "Id" = $1 AND "PersonId" = $2 AND "TreeId" = $3`,
        [variantId, personId, treeId]
      );
      if ((res.rowCount ?? 0) === 0) {
        await safeRollback(client);
        throw new NotFoundError('Not found');
      }
    }

    const afterRes = await client.query(
      `SELECT * FROM "NameVariant" WHERE "PersonId" = $1 AND "TreeId" = $2 AND "Id" = ANY($3)`,
      [personId, treeId, beforeRows.map((r) => r.Id)]
    );
    const afterById = new Map<number, Record<string, unknown>>(
      (afterRes.rows as Record<string, unknown>[]).map((r) => [r.Id as number, r])
    );
    // Demoting the old primary and promoting this one are separate entries; Undo
    // reverts them together.
    const auditIds: (number | null)[] = [];
    for (const before of beforeRows) {
      const after = afterById.get(before.Id as number);
      if (after) {
        auditIds.push(await auditUpdate('namevariant', before, after, NAME_VARIANT_FIELDS, scope.ownerId, currentUserId, client));
      }
    }

    // Fetch the target's final state on the SAME connection. PGlite serializes
    // every query through one mutex, so a global query() here would deadlock
    // against this still-open transaction (the pg pool wouldn't). The route
    // discards this value; it exists only to satisfy the typed NameVariant return.
    const targetRes = await client.query(
      `SELECT "Id", "PersonId", "Type", "Name", "FromDate", "ToDate", "IsPrimary"
       FROM "NameVariant" WHERE "Id" = $1 AND "PersonId" = $2 AND "TreeId" = $3`,
      [variantId, personId, treeId]
    );

    await client.query('COMMIT');

    // No NotFoundError here: when isPrimary is false and the variant is absent,
    // the original route returned success (the makePrimary branch is the only
    // 404 path). HTTP returns undefined for this method at runtime; mirror that.
    return withAuditIds((targetRes.rows[0] ?? {}) as NameVariant, auditIds);
  } catch (err) {
    // The isPrimary-miss path already rolled back before throwing NotFoundError;
    // any other failure still needs a rollback. Rolling back an already-aborted
    // transaction twice would error, so skip it for that pre-rolled-back case.
    if (!(err instanceof NotFoundError)) {
      await safeRollback(client);
    }
    throw err;
  } finally {
    client.release();
  }
}

export interface RemoveNameVariantParams {
  personId: number;
  variantId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** DELETE logic: snapshot → auditDelete → delete; NotFoundError when absent.
 *  Deletes need owner/edit ('contribute' blocks deletes, same as top-level entities). */
export async function removeNameVariantService(params: RemoveNameVariantParams): Promise<Audited> {
  const { personId, variantId, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }

  const before = await query(
    `SELECT * FROM "NameVariant" WHERE "Id" = $1 AND "PersonId" = $2 AND "TreeId" = $3`,
    [variantId, personId, scope.treeId]
  );
  const beforeRow = before.rows[0] as Record<string, unknown> | undefined;
  if (!beforeRow) throw new NotFoundError('Not found');

  const result = await query(
    `DELETE FROM "NameVariant" WHERE "Id" = $1 AND "PersonId" = $2 AND "TreeId" = $3`,
    [variantId, personId, scope.treeId]
  );
  if ((result.rowCount ?? 0) === 0) throw new NotFoundError('Not found');
  return withAuditIds({}, [await auditDelete('namevariant', beforeRow, scope.ownerId, currentUserId)]);
}

export interface UpdateNameVariantParams {
  personId: number;
  variantId: number;
  /** `FromDate`/`ToDate` (#898): omitted keeps the stored value, null or '' clears it. */
  body: { Name?: string; Type?: string; FromDate?: string | null; ToDate?: string | null };
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * PATCH logic (text edit): update a variant's Name in place. Snapshot →
 * auditUpdate so the change is revertable like every other name-variant edit.
 */
export async function updateNameVariantService(params: UpdateNameVariantParams): Promise<Audited<NameVariant>> {
  const { personId, variantId, body, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('View-only access');

  const before = await query(
    `SELECT * FROM "NameVariant" WHERE "Id" = $1 AND "PersonId" = $2 AND "TreeId" = $3`,
    [variantId, personId, scope.treeId]
  );
  const beforeRow = before.rows[0] as Record<string, unknown> | undefined;
  if (!beforeRow) throw new NotFoundError('Not found');

  // Checked against the stored name: an imported variant may exceed the cap (#884).
  const name = validateNameField(body.Name, 'Name', 200, beforeRow.Name as string | null);
  if (!name) throw new ValidationError('Name is required');
  // The "dates used" range (#898), validated like create's.
  const dateOrKeep = (key: 'FromDate' | 'ToDate') => {
    if (!(key in body)) return beforeRow[key] as string | null;
    const value = body[key];
    return value ? validateDateField(value, key, 100) : null;
  };
  const fromDate = dateOrKeep('FromDate');
  const toDate = dateOrKeep('ToDate');
  // The phone's name sheet can change the type too (#1052); omitted keeps it.
  const type = body.Type === undefined ? beforeRow.Type as string : body.Type;
  // A stored type outside the list (an import) may stay; a new one must be on it.
  if (type !== beforeRow.Type && !NAME_VARIANT_ALLOWED_TYPES.has(type)) throw new ValidationError(`Invalid type: ${type}`);

  const result = await query(
    `UPDATE "NameVariant" SET "Name" = $4, "FromDate" = $5, "ToDate" = $6, "Type" = $7
     WHERE "Id" = $1 AND "PersonId" = $2 AND "TreeId" = $3
     RETURNING "Id", "PersonId", "Type", "Name", "FromDate", "ToDate", "IsPrimary", "TreeId"`,
    [variantId, personId, scope.treeId, name, fromDate, toDate, type]
  );
  const afterRow = result.rows[0] as Record<string, unknown> | undefined;
  if (!afterRow) throw new NotFoundError('Not found');
  const auditId = await auditUpdate('namevariant', beforeRow, afterRow, NAME_VARIANT_FIELDS, scope.ownerId, currentUserId);
  return withAuditIds(result.rows[0] as NameVariant, [auditId]);
}

export interface SuggestFamilyServiceParams {
  lastName: string;
  birthDate: string;
  sex?: string;
  birthPlace?: string;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/people/suggest-family logic: parse birth year, score candidates. */
export async function suggestFamilyService(
  params: SuggestFamilyServiceParams
): Promise<FamilySuggestion[]> {
  const { lastName, birthDate, sex, birthPlace, requestedTreeId, requestedOwnerId, currentUserId } = params;
  if (!lastName || !birthDate) return [];

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );

  const birthYear = sortableYear(birthDate);
  if (birthYear === null) return [];

  const [familyCandidates, spouseCandidates] = await Promise.all([
    suggestFamiliesForPerson(scope.treeId, lastName),
    suggestSpousesForPerson(scope.treeId, birthYear),
  ]);

  return scoreSuggestions(
    { lastName, birthYear, sex: sex || undefined, birthPlace: birthPlace || undefined },
    familyCandidates,
    spouseCandidates
  );
}

export interface DescendantCountParams {
  personId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * How many people descend from this one, all generations. Its own endpoint
 * because the hero needs the number for a button label on every person view, and
 * the descendants TREE endpoint ships the whole tree to produce it.
 */
export async function descendantCountService(params: DescendantCountParams): Promise<number> {
  const { personId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (!(await personExistsInTree(personId, scope.treeId))) {
    throw new NotFoundError('Person not found in this tree');
  }
  return countDescendantsOfPerson(personId, scope.treeId);
}
