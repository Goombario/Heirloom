import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

const USER_ID = 987654;
const SHARED_NOTE_GEDCOM = [
  '0 HEAD',
  '0 @I1@ INDI', '1 NAME John /Doe/', '1 NOTE @N1@',
  '0 @F1@ FAM', '1 HUSB @I1@', '1 NOTE @N1@',
  '0 @N1@ NOTE Shared across the person and family',
  '0 TRLR',
].join('\n');

const FACT_SHARED_NOTE_GEDCOM = [
  '0 HEAD',
  '0 @I1@ INDI', '1 NAME John /Doe/',
  '1 BIRT', '2 NOTE @N1@',
  '1 DEAT', '2 NOTE @N1@',
  '0 @N1@ NOTE Shared across two facts',
  '0 TRLR',
].join('\n');

const FACT_BIRTH_ONLY_GEDCOM = [
  '0 HEAD',
  '0 @I1@ INDI', '1 NAME John /Doe/',
  '1 BIRT', '2 NOTE @N1@',
  '0 @N1@ NOTE Shared across two facts',
  '0 TRLR',
].join('\n');

const DUPLICATE_NOTE_GEDCOM = [
  '0 HEAD',
  '0 @I1@ INDI', '1 NAME John /Doe/', '1 NOTE @N1@', '1 NOTE @N1@',
  '0 @N1@ NOTE Repeated pointer',
  '0 TRLR',
].join('\n');

describe('GEDCOM shared NOTE xref identity', () => {
  let db: PGlite;
  let treeId: number;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
    await query(
      'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)',
      [USER_ID, 'shared-note-xref@test.local', 'shared-note-xref'],
    );
    treeId = await resolveDefaultTree(USER_ID);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  it('imports one shared NOTE row with two links in overwrite and merge modes', async () => {
    const file = () => new File([SHARED_NOTE_GEDCOM], 'shared.ged', { type: 'text/plain' });

    await importGedcomService({ file: file(), mode: 'overwrite', currentUserId: USER_ID });

    let notes = await query(
      'SELECT "Id" FROM "Note" WHERE "TreeId" = $1 AND "GedcomXref" = $2',
      [treeId, '@N1@'],
    );
    let links = await query(
      `SELECT l."OwnerTable", l."OwnerId"
         FROM "NoteLink" l JOIN "Note" n ON n."Id" = l."NoteId"
        WHERE n."TreeId" = $1 AND n."GedcomXref" = $2
        ORDER BY l."OwnerTable"`,
      [treeId, '@N1@'],
    );
    expect(notes.rows).toHaveLength(1);
    expect(links.rows).toHaveLength(2);
    expect((links.rows as Array<{ OwnerTable: string }>).map((r) => r.OwnerTable))
      .toEqual(['Families', 'People']);

    await importGedcomService({ file: file(), mode: 'merge', currentUserId: USER_ID });

    notes = await query(
      'SELECT "Id" FROM "Note" WHERE "TreeId" = $1 AND "GedcomXref" = $2',
      [treeId, '@N1@'],
    );
    links = await query(
      `SELECT l."OwnerTable", l."OwnerId"
         FROM "NoteLink" l JOIN "Note" n ON n."Id" = l."NoteId"
        WHERE n."TreeId" = $1 AND n."GedcomXref" = $2`,
      [treeId, '@N1@'],
    );
    expect(notes.rows).toHaveLength(1);
    expect(links.rows).toHaveLength(2);
  });

  it('preserves one shared NOTE link for both Birth and Death on the same person', async () => {
    await importGedcomService({
      file: new File([FACT_SHARED_NOTE_GEDCOM], 'fact-shared.ged', { type: 'text/plain' }),
      mode: 'overwrite',
      currentUserId: USER_ID,
    });

    const links = await query(
      `SELECT l."OwnerFact" FROM "NoteLink" l JOIN "Note" n ON n."Id" = l."NoteId"
        WHERE n."TreeId" = $1 AND n."GedcomXref" = $2 ORDER BY l."OwnerFact"`,
      [treeId, '@N1@'],
    );
    expect(links.rows).toEqual([{ OwnerFact: 'Birth' }, { OwnerFact: 'Death' }]);
  });

  it('preserves a new promoted-fact link when merge sees the shared NOTE already linked elsewhere', async () => {
    await importGedcomService({
      file: new File([FACT_BIRTH_ONLY_GEDCOM], 'fact-birth-only.ged', { type: 'text/plain' }),
      mode: 'overwrite',
      currentUserId: USER_ID,
    });
    await importGedcomService({
      file: new File([FACT_SHARED_NOTE_GEDCOM], 'fact-shared-merge.ged', { type: 'text/plain' }),
      mode: 'merge',
      currentUserId: USER_ID,
    });

    const links = await query(
      `SELECT l."OwnerFact" FROM "NoteLink" l JOIN "Note" n ON n."Id" = l."NoteId"
        WHERE n."TreeId" = $1 AND n."GedcomXref" = $2 ORDER BY l."OwnerFact"`,
      [treeId, '@N1@'],
    );
    expect(links.rows).toEqual([{ OwnerFact: 'Birth' }, { OwnerFact: 'Death' }]);
  });

  it('does not fail or duplicate a link when the same pointer repeats for one owner', async () => {
    await importGedcomService({
      file: new File([DUPLICATE_NOTE_GEDCOM], 'duplicate.ged', { type: 'text/plain' }),
      mode: 'overwrite',
      currentUserId: USER_ID,
    });

    const links = await query(
      `SELECT l."OwnerTable", l."OwnerId" FROM "NoteLink" l
         JOIN "Note" n ON n."Id" = l."NoteId"
        WHERE n."TreeId" = $1 AND n."GedcomXref" = $2`,
      [treeId, '@N1@'],
    );
    expect(links.rows).toHaveLength(1);
  });
});
