import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { revertAuditEntries } from '@/lib/db/queries/audit';
import { createNoteForOwnerService, moveNoteService } from '@/lib/services/notes';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * A note can move to another thing it is about (ADR 0043, superseding ADR 0016
 * decision 3): between a person's general notes, their birth and one of their
 * events. The note keeps its id and text, and Undo puts it back.
 */
const OWNER = 1;
const VIEWER = 2;
const TREE = 1;

describe('moving a note (#49, ADR 0043)', () => {
  let db: PGlite;
  let personId: number;
  let eventId: number;
  let otherTreeEvent: number;
  const as = (currentUserId: number) => ({ requestedTreeId: TREE, requestedOwnerId: null, currentUserId });
  const links = async (noteId: number) =>
    (await query(`SELECT "OwnerTable", "OwnerId", "OwnerFact", "AddedInApp" FROM "NoteLink" WHERE "NoteId" = $1 ORDER BY "OwnerTable"`, [noteId])).rows;
  const person = (ownerFact: 'Birth' | 'Death' | null = null) => ({ ownerTable: 'People', ownerId: personId, ownerFact });
  const event = () => ({ ownerTable: 'Events', ownerId: eventId, ownerFact: null });

  beforeAll(async () => { db = await newEmptyClusterDb(); __setTestDb(db); await query('SELECT 1'); });
  afterAll(async () => { __setTestDb(null); await db.close(); });
  beforeEach(async () => {
    await truncateAllTables(db);
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, 'o@example.test', 'o'), ($2, 'v@example.test', 'v')`, [OWNER, VIEWER]);
    await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES ($1, $2, 'Arbor'), (2, $2, 'Other')`, [TREE, OWNER]);
    await query(`INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "Permission", "TreeId") VALUES ($1, $2, 'view', $3)`, [OWNER, VIEWER, TREE]);
    personId = ((await query(`INSERT INTO "People" ("UserId", "TreeId", "FirstName", "BirthDate") VALUES ($1, $2, 'Anna', '1868') RETURNING "Id"`, [OWNER, TREE])).rows[0] as { Id: number }).Id;
    eventId = ((await query(`INSERT INTO "Events" ("UserId", "TreeId", "Type", "Date", "PersonId") VALUES ($1, $2, 'CENS', '1880', $3) RETURNING "Id"`, [OWNER, TREE, personId])).rows[0] as { Id: number }).Id;
    const stranger = ((await query(`INSERT INTO "People" ("UserId", "TreeId", "FirstName") VALUES ($1, 2, 'Ola') RETURNING "Id"`, [OWNER])).rows[0] as { Id: number }).Id;
    otherTreeEvent = ((await query(`INSERT INTO "Events" ("UserId", "TreeId", "Type", "PersonId") VALUES ($1, 2, 'CENS', $2) RETURNING "Id"`, [OWNER, stranger])).rows[0] as { Id: number }).Id;
  });

  it('moves a note to the birth on the same person, and Undo moves it back', async () => {
    const note = await createNoteForOwnerService({ ownerTable: 'People', ownerId: personId, text: 'Born at the mill', ...as(OWNER) });
    const { auditIds } = await moveNoteService({ id: note.Id, from: person(), to: person('Birth'), ...as(OWNER) });
    expect(await links(note.Id)).toEqual([{ OwnerTable: 'People', OwnerId: personId, OwnerFact: 'Birth', AddedInApp: 1 }]);
    expect(auditIds).toHaveLength(1);

    await revertAuditEntries(auditIds, TREE, OWNER, OWNER);
    expect(await links(note.Id)).toEqual([{ OwnerTable: 'People', OwnerId: personId, OwnerFact: null, AddedInApp: 1 }]);
  });

  it('moves a note to an event, keeping the note, and Undo brings it back to the person', async () => {
    const note = await createNoteForOwnerService({ ownerTable: 'People', ownerId: personId, text: 'Listed as a servant', ...as(OWNER) });
    const { auditIds } = await moveNoteService({ id: note.Id, from: person(), to: event(), ...as(OWNER) });
    expect(await links(note.Id)).toEqual([{ OwnerTable: 'Events', OwnerId: eventId, OwnerFact: null, AddedInApp: 1 }]);
    expect(auditIds).toHaveLength(2);

    await revertAuditEntries(auditIds, TREE, OWNER, OWNER);
    expect(await links(note.Id)).toEqual([{ OwnerTable: 'People', OwnerId: personId, OwnerFact: null, AddedInApp: 1 }]);
    const text = (await query(`SELECT "Text" FROM "Note" WHERE "Id" = $1`, [note.Id])).rows[0] as { Text: string };
    expect(text.Text).toBe('Listed as a servant');
  });

  it('refuses a viewer, a record in another tree, and a note already there', async () => {
    const note = await createNoteForOwnerService({ ownerTable: 'People', ownerId: personId, text: 'A note', ...as(OWNER) });
    await expect(moveNoteService({ id: note.Id, from: person(), to: event(), ...as(VIEWER) })).rejects.toThrow(/view permission/);
    await expect(moveNoteService({ id: note.Id, from: person(), to: { ownerTable: 'Events', ownerId: otherTreeEvent, ownerFact: null }, ...as(OWNER) }))
      .rejects.toThrow(/not found/i);
    await query(`INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId") VALUES ($1, 'Events', $2)`, [note.Id, eventId]);
    await expect(moveNoteService({ id: note.Id, from: person(), to: event(), ...as(OWNER) })).rejects.toThrow(/already there/);
    await expect(moveNoteService({ id: note.Id, from: person('Death'), to: person('Birth'), ...as(OWNER) })).rejects.toThrow(/not found/i);
    await expect(moveNoteService({ id: note.Id, from: person(), to: { ownerTable: 'Events', ownerId: eventId, ownerFact: 'Birth' }, ...as(OWNER) })).rejects.toThrow(/Invalid note scope/);
    expect(await links(note.Id)).toHaveLength(2);
  });
});
