import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';
import {
  getNotesForOwner,
  getAllNotes,
  getAllNoteLinks,
  createNoteForOwner,
  unlinkNote,
  deleteNotesForOwner,
} from '@/lib/db/queries/notes';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// Dedicated, otherwise-unused user id — integration tests run in parallel against
// one Postgres, so this keeps the suite isolated (see gedcom-passthrough.test.ts).
const NOTES_USER = 987655;

function gedFile(text: string): File {
  return new File([text], 'family_tree.ged', { type: 'text/plain' });
}

d('Notes as first-class records (Slice 1)', () => {
  // Multi-tree: the import resolves this user's default tree (Trees FK's Users,
  // so the synthetic id needs a real Users row) and stamps TreeId on every row;
  // the tree-scoped readers below take that treeId.
  let treeId: number;

  beforeAll(async () => {
    await query(
      'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3) ON CONFLICT ("Id") DO NOTHING',
      [NOTES_USER, `gedcom-notes-${NOTES_USER}@test.local`, `google-${NOTES_USER}`],
    );
    treeId = await resolveDefaultTree(NOTES_USER);
  });

  afterEach(async () => {
    // Note rows cascade their NoteLink rows on delete (FK ON DELETE CASCADE).
    await query('DELETE FROM "Note" WHERE "OwnerId" = $1', [NOTES_USER]);
    await query('DELETE FROM "Sources" WHERE "OwnerId" = $1', [NOTES_USER]);
    await query('DELETE FROM "Events" WHERE "UserId" = $1', [NOTES_USER]);
    await query('DELETE FROM "Families" WHERE "UserId" = $1', [NOTES_USER]);
    await query('DELETE FROM "People" WHERE "UserId" = $1', [NOTES_USER]);
  });

  it('imports a shared NOTE record + pointer onto a family as Note + NoteLink', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME H /X/',
      '0 @F1@ FAM', '1 HUSB @I1@', '1 NOTE @N1@',
      '0 @N1@ NOTE They eloped',
      '1 CONT and were forgiven',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: NOTES_USER });

    const fam = await query('SELECT "Id" FROM "Families" WHERE "UserId" = $1 LIMIT 1', [NOTES_USER]);
    const familyId = (fam.rows[0] as { Id: number }).Id;

    const notes = await getNotesForOwner('Families', familyId, treeId);
    expect(notes).toHaveLength(1);
    expect(notes[0].Text).toBe('They eloped\nand were forgiven');
    expect(notes[0].GedcomXref).toBe('@N1@');
  });

  it('imports a 2 NOTE under a person event as Note + NoteLink(Events) (§4.1)', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME H /X/',
      '1 OCCU Blacksmith',
      '2 NOTE Worked at the village forge',
      '1 NOTE Person biography note',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: NOTES_USER });

    const evt = await query(
      `SELECT "Id" FROM "Events" WHERE "UserId" = $1 AND "Type" = 'OCCU' LIMIT 1`,
      [NOTES_USER],
    );
    const eventId = (evt.rows[0] as { Id: number }).Id;
    const notes = await getNotesForOwner('Events', eventId, treeId);
    expect(notes.map((n) => n.Text)).toEqual(['Worked at the village forge']);

    // The person-level 1 NOTE stayed on the person, not the event — as a
    // first-class NoteLink('People') row, the only person-note store now that
    // People."Notes" is dropped (#524 / ADR 0010).
    const person = await query('SELECT "Id" FROM "People" WHERE "UserId" = $1 LIMIT 1', [NOTES_USER]);
    const { Id: personId } = person.rows[0] as { Id: number };
    const personNotes = await getNotesForOwner('People', personId, treeId);
    expect(personNotes.map((n) => n.Text)).toEqual(['Person biography note']);
  });

  it('imports a NOTE on a source as Note + NoteLink(Sources)', async () => {
    const ged = [
      '0 HEAD',
      '0 @S1@ SOUR', '1 TITL Parish register', '1 NOTE Fragile — handle with care',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: NOTES_USER });

    const src = await query('SELECT "Id" FROM "Sources" WHERE "OwnerId" = $1 LIMIT 1', [NOTES_USER]);
    const sourceId = (src.rows[0] as { Id: number }).Id;
    const notes = await getNotesForOwner('Sources', sourceId, treeId);
    expect(notes.map((n) => n.Text)).toEqual(['Fragile — handle with care']);
  });

  it('overwrite import clears prior notes (no stale accumulation)', async () => {
    const ged1 = ['0 HEAD', '0 @S1@ SOUR', '1 TITL A', '1 NOTE first', '0 TRLR'].join('\n');
    await importGedcomService({ file: gedFile(ged1), mode: 'overwrite', currentUserId: NOTES_USER });
    const ged2 = ['0 HEAD', '0 @S1@ SOUR', '1 TITL B', '1 NOTE second', '0 TRLR'].join('\n');
    await importGedcomService({ file: gedFile(ged2), mode: 'overwrite', currentUserId: NOTES_USER });

    const allNotes = await getAllNotes(treeId);
    expect(allNotes.map((n) => n.Text)).toEqual(['second']);
    const allLinks = await getAllNoteLinks(treeId);
    expect(allLinks).toHaveLength(1);
  });

  it('data layer: create, share across owners, and app-layer cascade on unlink', async () => {
    // Two owner records to share one note across (use synthetic owner ids — the
    // link table is polymorphic with no FK).
    const note = await createNoteForOwner('Families', 1001, 'Shared research note', NOTES_USER, treeId);
    await query(
      'INSERT INTO "NoteLink" ("NoteId", "OwnerTable", "OwnerId") VALUES ($1, $2, $3)',
      [note.Id, 'Sources', 2002]
    );

    expect((await getNotesForOwner('Families', 1001, treeId))).toHaveLength(1);
    expect((await getNotesForOwner('Sources', 2002, treeId))).toHaveLength(1);

    // Unlink one owner: note survives because it's still linked elsewhere.
    await unlinkNote(note.Id, 'Families', 1001, treeId);
    expect((await getNotesForOwner('Families', 1001, treeId))).toHaveLength(0);
    expect((await getNotesForOwner('Sources', 2002, treeId))).toHaveLength(1);

    // Unlink the last owner: the orphaned note is swept.
    await unlinkNote(note.Id, 'Sources', 2002, treeId);
    expect(await getAllNotes(treeId)).toHaveLength(0);
  });

  it('deleteNotesForOwner sweeps notes attached only to that owner', async () => {
    await createNoteForOwner('Families', 3003, 'Only here', NOTES_USER, treeId);
    const removed = await deleteNotesForOwner('Families', 3003, treeId);
    expect(removed).toBe(1);
    expect(await getAllNotes(treeId)).toHaveLength(0);
  });
});
