import { createEvent, getEventById, updateEvent, deleteEvent } from '@/lib/db/queries/events';
import type { Audited } from '@/lib/db/queries/audit-capture';
import { validateStringField, validateDateField, validateNameField, validatePlaceIdField, ValidationError } from '@/lib/validation';
import type { FactPlacePick } from '@/lib/db/queries/place-links';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { assertOwnerInTree } from '@/lib/services/owner-links';
import type { NewGedcomEvent, GedcomEvent } from '@/lib/db/schema';
import type { EventInput } from '@/lib/data/types';

/**
 * IDOR guard (same contract as families' assertPartnersInTree): an event's
 * PersonId/FamilyId must reference a row in the SAME tree, or the event would
 * silently attach to another tree's (or another tenant's) record.
 * Ignores null/undefined (unlinking is allowed). Coerces before checking — a
 * `typeof === 'number'` guard alone lets a crafted string id ("123") skip the
 * check while Postgres still coerces and writes it.
 */
async function assertEventRefsInTree(
  personId: number | null | undefined,
  familyId: number | null | undefined,
  treeId: number,
): Promise<{ personId: number | null; familyId: number | null }> {
  const coerce = (value: unknown, field: string): number | null => {
    if (value == null) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new ValidationError(`${field} must be a positive integer`);
    return n;
  };
  const pid = coerce(personId, 'PersonId');
  const fid = coerce(familyId, 'FamilyId');
  if ((pid === null) === (fid === null)) {
    throw new ValidationError('Exactly one of PersonId or FamilyId is required');
  }
  if (pid !== null) await assertOwnerInTree('People', pid, treeId);
  if (fid !== null) await assertOwnerInTree('Families', fid, treeId);
  return { personId: pid, familyId: fid };
}

export interface CreateEventParams {
  body: EventInput;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** POST /api/events logic: validate access + input, then create. */
/**
 * A person's birth and death live on the `People` row (#756); GEDCOM import
 * promotes `BIRT`/`DEAT` there, and Add event → Birth writes the columns. A
 * person `BIRT`/`DEAT` Events row would be a second copy of the fact, splitting
 * its citations, so the API refuses to create one. A legacy row that already
 * exists can still be edited in place.
 */
export function assertNotPersonVital(type: string, personId: number | null, existing?: { Type: string; PersonId: number | null }): void {
  const tag = type.trim().toUpperCase();
  if (personId == null || (tag !== 'BIRT' && tag !== 'DEAT')) return;
  if (existing && existing.PersonId === personId && existing.Type.trim().toUpperCase() === tag) return;
  throw new ValidationError('Birth and death belong on the person, not as events');
}

export async function createEventService(params: CreateEventParams): Promise<Audited<GedcomEvent>> {
  const { body, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  if (!body.Type) throw new ValidationError('Event Type is required');

  const owner = await assertEventRefsInTree(body.PersonId, body.FamilyId, scope.treeId);

  const newEventData: NewGedcomEvent = {
    UserId: scope.ownerId, // legacy owner column: the TREE's owner (unchanged semantics for shared contributors)
    TreeId: scope.treeId,
    Type: validateStringField(body.Type, 'Type', 200) as string,
    Date: validateDateField(body.Date, 'Date', 100),
    Place: validateNameField(body.Place, 'Place', 500),
    Description: validateStringField(body.Description, 'Description', 10000),
    PersonId: owner.personId,
    FamilyId: owner.familyId,
  };
  assertNotPersonVital(newEventData.Type, owner.personId);

  return createEvent(newEventData, currentUserId, eventPlacePicks(body));
}

/** The place a form picked for the event, by id (#1186). */
function eventPlacePicks(body: { PlaceId?: unknown }): FactPlacePick[] {
  const placeId = validatePlaceIdField(body.PlaceId, 'PlaceId');
  return placeId != null ? [{ kind: 'event', placeId }] : [];
}

export interface UpdateEventParams {
  eventId: number;
  body: Partial<EventInput>;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** PUT /api/events/[id] logic: validate access + input, then update (audited). */
export async function updateEventService(params: UpdateEventParams): Promise<Audited<GedcomEvent>> {
  const { eventId, body, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const existing = await getEventById(eventId, scope.treeId);
  if (!existing) throw new NotFoundError('Event not found');
  const owner = await assertEventRefsInTree(
    body.PersonId !== undefined ? body.PersonId : existing.PersonId,
    body.FamilyId !== undefined ? body.FamilyId : existing.FamilyId,
    scope.treeId,
  );

  const updateData: Partial<NewGedcomEvent> = {};
  if (body.Type !== undefined) updateData.Type = validateStringField(body.Type, 'Type', 200) as string;
  if (body.Date !== undefined) updateData.Date = validateDateField(body.Date, 'Date', 100);
  if (body.Place !== undefined) updateData.Place = validateNameField(body.Place, 'Place', 500, existing.Place);
  if (body.Description !== undefined) updateData.Description = validateStringField(body.Description, 'Description', 10000);
  if (body.PersonId !== undefined) updateData.PersonId = owner.personId;
  if (body.FamilyId !== undefined) updateData.FamilyId = owner.familyId;
  assertNotPersonVital(updateData.Type ?? existing.Type, owner.personId, existing);

  return updateEvent(eventId, updateData, scope.treeId, currentUserId, eventPlacePicks(body));
}

export interface DeleteEventParams {
  eventId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** DELETE /api/events/[id] logic: validate access (owner/edit only), then delete (audited). */
export async function deleteEventService(params: DeleteEventParams): Promise<Audited<{ deleted: boolean }>> {
  const { eventId, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }

  return deleteEvent(eventId, scope.treeId, currentUserId);
}
