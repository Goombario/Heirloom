import { parseBodyId } from '@/lib/utils/parse-id';
import {
  getAllFamiliesWithSpouses,
  createFamily,
  getFamilyWithRelations,
  updateFamily,
  deleteFamily,
  searchFamilies,
  addChildToFamily,
  updateChildRelationshipType,
  removeChildFromFamily,
  moveChildToFamily,
  getFamiliesCount,
  getFamilyById,
  type FamilyWithSpouseNames,
} from '@/lib/db/queries/families';
import { parseChildRelationships, type ChildRelationshipInput } from '@/lib/child-relationship';
import { getEventsByFamilyId, getEventsByPersonIdsAndType } from '@/lib/db/queries/events';
import { attachMediaToEvents, getMediaForOwner } from '@/lib/db/queries/media-links';
import { getFamilyPhoto } from '@/lib/db/queries/media';
import { attachNoteCountsToEvents } from '@/lib/db/queries/notes';
import { validateDateField, validateNameField, validatePlaceIdField, ValidationError } from '@/lib/validation';
import type { FactPlacePick } from '@/lib/db/queries/place-links';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { query } from '@/lib/db/connection';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import type { NewFamily, Family, FamilyType, FamilyWithRelations } from '@/lib/db/schema';
import type { Audited, AuditedChange, FamilyDetail } from '@/lib/data/types';

/**
 * Defense-in-depth: a partner id supplied on create/update must be a person in
 * the SAME tree, or the family would reference another (same-owner) tree's
 * person. Ignores null/undefined (clearing a partner is allowed). Coerces
 * before checking — a `typeof === 'number'` filter alone lets a crafted string
 * id ("123") skip the check while Postgres still coerces and writes it.
 */
async function assertPartnersInTree(
  ids: Array<number | null | undefined>,
  treeId: number
): Promise<void> {
  const present = ids
    .filter((id) => id != null)
    .map((id) => {
      const n = Number(id);
      if (!Number.isInteger(n) || n <= 0) throw new ValidationError('Partner id must be a positive integer');
      return n;
    });
  if (present.length === 0) return;
  const result = await query(
    `SELECT "Id" FROM "People" WHERE "Id" = ANY($1) AND "TreeId" = $2`,
    [present, treeId]
  );
  if (result.rows.length !== new Set(present).size) {
    throw new ValidationError('Partner not found in this tree');
  }
}

export interface ListFamiliesParams {
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

export interface ListFamiliesResult {
  families: FamilyWithSpouseNames[];
  count: number;
}

/** GET /api/families logic. */
export async function listFamiliesService(
  params: ListFamiliesParams
): Promise<ListFamiliesResult> {
  const { requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  const [families, count] = await Promise.all([
    getAllFamiliesWithSpouses(scope.treeId),
    getFamiliesCount(scope.treeId),
  ]);
  return { families, count };
}

export interface CreateFamilyParams {
  body: Record<string, unknown>;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

const ALLOWED_TYPES = new Set(['Marriage', 'Civil union', 'Common-law', 'Other', 'Unknown']);

/** POST /api/families logic. */
export async function createFamilyService(params: CreateFamilyParams): Promise<Audited<Family>> {
  const { body, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const type = body.Type && ALLOWED_TYPES.has(body.Type as string) ? (body.Type as string) : 'Marriage';

  // Normalised before the tree check AND the write, so what's checked is what's stored (#51, L-1).
  const partner1Id = parseBodyId(body.Partner1Id ?? body.HusbandId ?? null, 'Partner1Id') ?? null;
  const partner2Id = parseBodyId(body.Partner2Id ?? body.WifeId ?? null, 'Partner2Id') ?? null;
  await assertPartnersInTree([partner1Id, partner2Id], scope.treeId);

  const newFamilyData: NewFamily = {
    UserId: scope.ownerId, // legacy owner column: the TREE's owner (unchanged semantics for shared contributors)
    TreeId: scope.treeId,
    Partner1Id: partner1Id,
    Partner2Id: partner2Id,
    MarriageDate: validateDateField(body.MarriageDate, 'MarriageDate', 100),
    MarriagePlace: validateNameField(body.MarriagePlace, 'MarriagePlace', 500),
    Type: type as FamilyType,
  };

  return createFamily(newFamilyData, currentUserId, familyPlacePicks(body));
}

/** The place a form picked for the marriage, by id (#1186). */
function familyPlacePicks(body: Record<string, unknown>): FactPlacePick[] {
  const placeId = validatePlaceIdField(body.MarriagePlaceId, 'MarriagePlaceId');
  return placeId != null ? [{ kind: 'marriage', placeId }] : [];
}

export interface GetFamilyParams {
  id: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/families/[id] logic: returns a flat FamilyDetail (not the raw FamilyWithRelations). */
export async function getFamilyService(params: GetFamilyParams): Promise<FamilyDetail> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );

  const familyData: FamilyWithRelations | null = await getFamilyWithRelations(id, scope.treeId);
  if (!familyData) throw new NotFoundError('Family not found');

  // Attach each family event's media (MediaLink OwnerTable='Events') for the
  // family timeline's inline photo strips — one query, no per-event N+1.
  const events = await attachNoteCountsToEvents(
    await attachMediaToEvents(await getEventsByFamilyId(id, scope.treeId), scope.treeId),
    scope.treeId,
  );
  const marriageMedia = await getMediaForOwner('Families', id, scope.treeId, 'Marriage');
  const photo = await getFamilyPhoto(id, scope.treeId);
  // A child's adoption is a dated individual event (GEDCOM ADOP), shown on the
  // family timeline when one exists (#485).
  const childAdoptions = await getEventsByPersonIdsAndType((familyData.children ?? []).map((c) => c.Id), 'ADOP', scope.treeId);

  return {
    family: {
      Id: familyData.Id,
      Partner1Id: familyData.Partner1Id,
      Partner2Id: familyData.Partner2Id,
      MarriageDate: familyData.MarriageDate,
      MarriagePlace: familyData.MarriagePlace,
      MarriagePlaceId: familyData.MarriagePlaceId ?? null,
      Type: familyData.Type ?? 'Marriage',
    },
    husband: familyData.husband,
    wife: familyData.wife,
    children: familyData.children,
    events,
    marriageMedia,
    childAdoptions,
    photo,
  };
}

export interface UpdateFamilyParams {
  id: number;
  body: Record<string, unknown>;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** PUT /api/families/[id] logic. */
export async function updateFamilyService(params: UpdateFamilyParams): Promise<Audited<Family>> {
  const { id, body, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const updateData: Partial<NewFamily> = {};
  if (body.Partner1Id !== undefined) updateData.Partner1Id = parseBodyId(body.Partner1Id, 'Partner1Id');
  if (body.Partner2Id !== undefined) updateData.Partner2Id = parseBodyId(body.Partner2Id, 'Partner2Id');
  if (body.HusbandId !== undefined) updateData.Partner1Id = parseBodyId(body.HusbandId, 'HusbandId');
  if (body.WifeId !== undefined) updateData.Partner2Id = parseBodyId(body.WifeId, 'WifeId');
  // Defense-in-depth: any partner being set must be a person in this tree.
  await assertPartnersInTree([updateData.Partner1Id, updateData.Partner2Id], scope.treeId);
  if (body.MarriageDate !== undefined) updateData.MarriageDate = validateDateField(body.MarriageDate, 'MarriageDate', 100);
  if (body.MarriagePlace !== undefined) {
    // An imported place may exceed the cap; resending it unchanged is fine (#884).
    const overCap = typeof body.MarriagePlace === 'string' && body.MarriagePlace.length > 500;
    const stored = overCap ? (await getFamilyById(id, scope.treeId))?.MarriagePlace : undefined;
    updateData.MarriagePlace = validateNameField(body.MarriagePlace, 'MarriagePlace', 500, stored);
  }
  if (body.Type !== undefined) {
    if (body.Type !== null && !ALLOWED_TYPES.has(body.Type as string)) {
      throw new ValidationError(`Invalid Type: ${body.Type}`);
    }
    updateData.Type = body.Type as FamilyType | null;
  }

  return updateFamily(id, updateData, scope.treeId, currentUserId, familyPlacePicks(body));
}

export interface DeleteFamilyParams {
  id: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** DELETE /api/families/[id] logic. */
export async function deleteFamilyService(params: DeleteFamilyParams): Promise<AuditedChange> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }
  const { deleted, auditId } = await deleteFamily(id, scope.treeId, currentUserId);
  if (!deleted) throw new NotFoundError('Family not found');
  return { auditId };
}

export interface SearchFamiliesParams {
  q: string;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/families/search logic. */
export async function searchFamiliesService(
  params: SearchFamiliesParams
): Promise<FamilyWithSpouseNames[]> {
  const { q, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  return searchFamilies(q, scope.treeId);
}

export interface ChildOperationParams {
  familyId: number;
  childId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * POST /api/families/[id]/children logic. Wraps query-fn errors in typed errors so the
 * local client and the route see the same error contract.
 */
export async function addChildToFamilyService(
  params: ChildOperationParams & { relationship?: ChildRelationshipInput }
): Promise<Audited> {
  const { familyId, childId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  // Validated HERE, not only in the route: the static/desktop build's
  // LocalFamiliesClient calls this service directly, and the columns are
  // unchecked TEXT.
  const relationship = parseChildRelationships(params.relationship ?? 'Birth');
  if (!relationship) {
    throw new ValidationError('Invalid relationshipType');
  }
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('View-only permission');
  try {
    return { auditIds: idsOf(await addChildToFamily(familyId, childId, scope.treeId, relationship, currentUserId)) };
  } catch (err) {
    mapChildError(err);
    throw err;
  }
}

export interface UpdateChildTypeParams extends ChildOperationParams {
  /** One type for both partners, or one per partner (#982). */
  relationship: ChildRelationshipInput;
}

/** PATCH /api/families/[id]/children logic. */
export async function updateChildTypeService(params: UpdateChildTypeParams): Promise<Audited> {
  const { familyId, childId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  // Same reasoning as addChildToFamilyService above.
  const relationship = parseChildRelationships(params.relationship);
  if (!relationship) {
    throw new ValidationError('Invalid relationshipType');
  }
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('View-only permission');
  try {
    return { auditIds: idsOf(await updateChildRelationshipType(familyId, childId, relationship, scope.treeId, currentUserId)) };
  } catch (err) {
    mapChildError(err);
    throw err;
  }
}

/** DELETE /api/families/[id]/children logic. */
export async function removeChildService(params: ChildOperationParams): Promise<AuditedChange> {
  const { familyId, childId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }
  try {
    return { auditId: await removeChildFromFamily(familyId, childId, scope.treeId, currentUserId) };
  } catch (err) {
    mapChildError(err);
    throw err;
  }
}

/**
 * POST /api/families/[id]/children/move logic (#796). Moving takes a child out of
 * one family, so it needs the same permission as removing one.
 */
export async function moveChildService(params: ChildOperationParams & { toFamilyId: number }): Promise<AuditedChange> {
  const { familyId, toFamilyId, childId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }
  try {
    return { auditId: await moveChildToFamily(familyId, toFamilyId, childId, scope.treeId, currentUserId) };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('The child is already')) throw new ValidationError(err.message);
    mapChildError(err);
    throw err;
  }
}

/** Map plain errors from child query fns to typed errors (for clean local-client contract). */
function mapChildError(err: unknown): never | void {
  if (!(err instanceof Error)) return;
  if (err.message.startsWith('Permission denied')) throw new AccessError(err.message);
  if (err.message.toLowerCase().includes('not found')) throw new NotFoundError(err.message);
}

/** A single audit id as the `auditIds` list a write returns: none when nothing changed. */
function idsOf(auditId: number | null): number[] {
  return auditId == null ? [] : [auditId];
}
