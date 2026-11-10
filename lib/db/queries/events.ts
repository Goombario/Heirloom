import { query } from '@/lib/db/connection';
import { factPlaceRefChanges, factPlaceRefs, factPlaceTextColumns, type FactPlacePick } from './place-links';

/** An event row with its place text, built from its references (ADR 0037). */
const EVENT_ROW = `e.*, ${factPlaceTextColumns('events', 'e')}`;
import type { GedcomEvent, NewGedcomEvent } from '../schema';
import { hasEditPermission } from './sharing';
import { auditCreate, auditUpdate, auditDelete, withAuditIds, type Audited } from './audit-capture';

/**
 * Get all events in a specific tree
 */
export async function getAllEvents(treeId: number): Promise<GedcomEvent[]> {
    const result = await query(
        `SELECT ${EVENT_ROW} FROM "Events" e WHERE e."TreeId" = $1 ORDER BY e."Date" DESC`,
        [treeId]
    );
    return result.rows as GedcomEvent[];
}

/**
 * Get a single event by ID (tree-scoped)
 */
export async function getEventById(id: number, treeId: number): Promise<GedcomEvent | null> {
    const result = await query(
        `SELECT ${EVENT_ROW} FROM "Events" e WHERE e."Id" = $1 AND e."TreeId" = $2`,
        [id, treeId]
    );
    return (result.rows[0] as GedcomEvent) || null;
}

/**
 * Get events for a specific person, tree-scoped
 */
export async function getEventsByPersonId(personId: number, treeId: number): Promise<GedcomEvent[]> {
    const result = await query(
        `SELECT ${EVENT_ROW} FROM "Events" e WHERE e."PersonId" = $1 AND e."TreeId" = $2 ORDER BY e."Date"`,
        [personId, treeId]
    );
    return result.rows as GedcomEvent[];
}

/**
 * Get events for a specific family, tree-scoped
 */
export async function getEventsByFamilyId(familyId: number, treeId: number): Promise<GedcomEvent[]> {
    const result = await query(
        `SELECT ${EVENT_ROW} FROM "Events" e WHERE e."FamilyId" = $1 AND e."TreeId" = $2 ORDER BY e."Date"`,
        [familyId, treeId]
    );
    return result.rows as GedcomEvent[];
}

/**
 * Events of one type for a set of people, tree-scoped: a family's children's
 * adoptions (`ADOP`) for its timeline (#485).
 */
export async function getEventsByPersonIdsAndType(personIds: number[], type: string, treeId: number): Promise<GedcomEvent[]> {
    if (personIds.length === 0) return [];
    const result = await query(
        `SELECT ${EVENT_ROW} FROM "Events" e WHERE e."Type" = $1 AND e."TreeId" = $2 AND e."PersonId" = ANY($3) ORDER BY e."Date", e."Id"`,
        [type, treeId, personIds]
    );
    return result.rows as GedcomEvent[];
}

/**
 * Create a new event
 */
export async function createEvent(data: NewGedcomEvent, actingUserId?: number, placePicks: readonly FactPlacePick[] = []): Promise<Audited<GedcomEvent>> {
    // The event's place, matched to the tree's places once, here.
    const places = data.TreeId != null
        ? await factPlaceRefs({ query }, data.TreeId, data.UserId, { Place: data.Place ?? null }, placePicks)
        : [];
    const columns = ['"UserId"', '"TreeId"', '"Type"', '"Date"', '"Description"', '"PersonId"', '"FamilyId"', ...places.map(([c]) => c)];
    const values = [data.UserId, data.TreeId ?? null, data.Type, data.Date, data.Description, data.PersonId, data.FamilyId, ...places.map(([, v]) => v)];
    const result = await query(
        `INSERT INTO "Events" (${columns.join(', ')})
         VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING *, ${factPlaceTextColumns('events', '"Events"')}`,
        values
    );

    const newEvent = result.rows[0] as GedcomEvent;
    if (!newEvent) {
        throw new Error('Failed to create event');
    }

    const auditId = await auditCreate('event', newEvent as unknown as Record<string, unknown>, data.UserId, actingUserId ?? data.UserId);

    return withAuditIds(newEvent, [auditId]);
}

const ALLOWED_EVENT_FIELDS: ReadonlySet<string> = new Set([
    'Type', 'Date', 'Place', 'Description', 'PersonId', 'FamilyId',
]);

/**
 * Update an existing event. Authorization = the tree-scoped SELECT (the row
 * must be in the caller's resolved tree) + the user-keyed edit check kept as
 * defense in depth. `actingUserId` defaults to the tree owner for callers that
 * predate the scope split.
 */
export async function updateEvent(id: number, data: Partial<NewGedcomEvent>, treeId: number, actingUserId?: number, placePicks: readonly FactPlacePick[] = []): Promise<Audited<GedcomEvent>> {
    const event = await getEventById(id, treeId);
    if (!event) {
        throw new Error('Event not found');
    }

    const actor = actingUserId ?? event.UserId;
    if (!(await hasEditPermission(event.UserId, actor, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    const fields = Object.keys(data).filter(key => data[key as keyof NewGedcomEvent] !== undefined && key !== 'UserId' && key !== 'TreeId');
    for (const field of fields) {
        if (!ALLOWED_EVENT_FIELDS.has(field)) {
            throw new Error(`Invalid field name: ${field}`);
        }
    }

    // The place is matched again only when its text changed or a place was picked
    // for it: an unchanged "Paris" stays on whichever Paris it points at. A pick
    // sent without the text applies to the text the fact shows now.
    const placeSent = fields.includes('Place');
    const placePicked = placePicks.some((p) => p.kind === 'event');
    const placeChanged = placeSent ? data.Place !== event.Place || placePicked : placePicked;
    const places = placeChanged
        ? await factPlaceRefs({ query }, treeId, event.UserId, { Place: (placeSent ? data.Place : event.Place) ?? null }, placePicks)
        : [];
    const columns = [
        ...fields.filter((f) => f !== 'Place').map((f) => [`"${f}"`, data[f as keyof NewGedcomEvent]] as const),
        ...places,
    ];
    if (columns.length > 0) {
        const values: unknown[] = columns.map(([, v]) => v);
        const setClauses = columns.map(([c], i) => `${c} = $${i + 1}`);
        values.push(id);
        await query(
            `UPDATE "Events" SET ${setClauses.join(', ')} WHERE "Id" = $${values.length}`,
            values
        );
    }

    const updatedEvent = await getEventById(id, treeId);
    if (!updatedEvent) {
        throw new Error('Failed to update event');
    }

    const auditId = await auditUpdate(
        'event', event as unknown as Record<string, unknown>, updatedEvent as unknown as Record<string, unknown>, ALLOWED_EVENT_FIELDS, event.UserId, actor,
        undefined, factPlaceRefChanges('events', event as unknown as Record<string, unknown>, updatedEvent as unknown as Record<string, unknown>),
    );

    return withAuditIds(updatedEvent, [auditId]);
}

/**
 * Delete an event (tree-scoped authorizing SELECT + user-keyed edit check). Its
 * citations stay in place (no FK), so reverting the delete re-inserts the event
 * under the same Id and they attach again.
 */
export async function deleteEvent(id: number, treeId: number, actingUserId?: number): Promise<Audited<{ deleted: boolean }>> {
    const event = await getEventById(id, treeId);
    if (!event) {
        return { deleted: false, auditIds: [] };
    }

    const actor = actingUserId ?? event.UserId;
    if (!(await hasEditPermission(event.UserId, actor, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    const auditId = await auditDelete('event', event as unknown as Record<string, unknown>, event.UserId, actor);

    const result = await query('DELETE FROM "Events" WHERE "Id" = $1', [id]);
    return withAuditIds({ deleted: (result.rowCount ?? 0) > 0 }, [auditId]);
}

/**
 * Get total count of events in a specific tree
 */
export async function getEventsCount(treeId: number): Promise<number> {
    const result = await query(
        `SELECT COUNT(*) as count FROM "Events" WHERE "TreeId" = $1`,
        [treeId]
    );
    return parseInt(result.rows[0].count, 10);
}
