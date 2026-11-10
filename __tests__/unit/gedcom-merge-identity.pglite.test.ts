import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

const USER_ID = 871871;

const SMITHS = [
  '0 HEAD',
  '0 @I1@ INDI', '1 NAME John /Smith/', '1 SEX M', '1 BIRT', '2 DATE 1900',
  '0 @I2@ INDI', '1 NAME Mary /Smith/', '1 SEX F',
  '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
  '0 TRLR',
].join('\n');

// An unrelated family that happens to number its people the same way (#871).
const GARCIAS = [
  '0 HEAD',
  '0 @I1@ INDI', '1 NAME Maria /Garcia/', '1 SEX F', '1 BIRT', '2 DATE 1950',
  '1 OCCU Nurse', '2 PLAC Madrid', '1 NICK Mari',
  '0 @I2@ INDI', '1 NAME Pedro /Lopez/', '1 SEX M',
  '0 @I3@ INDI', '1 NAME Ana /Lopez/', '1 SEX F',
  '0 @F1@ FAM', '1 HUSB @I2@', '1 WIFE @I1@', '1 CHIL @I3@',
  '0 TRLR',
].join('\n');

const ged = (text: string) => new File([text], 'tree.ged', { type: 'text/plain' });

async function snapshot(treeId: number) {
  const people = await query(
    `SELECT "Id", "FirstName", "LastName", "BirthDate", "GedcomId" FROM "People" WHERE "TreeId" = $1 ORDER BY "Id"`,
    [treeId],
  );
  const families = await query(
    `SELECT f."Id", f."Partner1Id", f."Partner2Id",
            (SELECT COUNT(*)::int FROM "FamilyPerson" fp WHERE fp."FamiliesAsChildId" = f."Id") AS "Children"
       FROM "Families" f WHERE f."TreeId" = $1 ORDER BY f."Id"`,
    [treeId],
  );
  const events = await query(`SELECT "Id" FROM "Events" WHERE "TreeId" = $1`, [treeId]);
  const variants = await query(`SELECT "PersonId", "Name" FROM "NameVariant" WHERE "TreeId" = $1`, [treeId]);
  return { people: people.rows, families: families.rows, events: events.rows.length, variants: variants.rows };
}

describe('merge import does not match people by xref alone (#871)', () => {
  let db: PGlite;
  let treeId: number;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
    await query(
      'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)',
      [USER_ID, 'merge-identity@test.local', 'merge-identity'],
    );
    treeId = await resolveDefaultTree(USER_ID);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  it('adds an unrelated file with the same xrefs as new people and leaves the existing ones alone', async () => {
    await importGedcomService({ file: ged(SMITHS), mode: 'overwrite', currentUserId: USER_ID });
    const before = await snapshot(treeId);
    const [john, mary] = before.people as Array<{ Id: number }>;

    const result = await importGedcomService({ file: ged(GARCIAS), mode: 'merge', currentUserId: USER_ID });
    expect(result.warnings).toContainEqual({ code: 'merge_xref_name_mismatch', values: { count: 2 } });

    const after = await snapshot(treeId);
    const names = (after.people as Array<{ FirstName: string; LastName: string }>).map((p) => `${p.FirstName} ${p.LastName}`);
    expect(names).toEqual(['John Smith', 'Mary Smith', 'Maria Garcia', 'Pedro Lopez', 'Ana Lopez']);
    // John and Mary are untouched: same rows, no new facts or nicknames.
    expect(after.people.slice(0, 2)).toEqual(before.people);
    expect(after.variants.filter((v) => (v as { PersonId: number }).PersonId === john.Id)).toEqual([]);
    const events = await query(
      'SELECT "Id" FROM "Events" WHERE "PersonId" = ANY($1::int[])',
      [[john.Id, mary.Id]],
    );
    expect(events.rows).toHaveLength(before.events);

    // One new family, for the new people; the Smiths' family keeps no extra child.
    expect(after.families).toHaveLength(2);
    expect(after.families[0]).toEqual(before.families[0]);
    const ids = (after.people as Array<{ Id: number }>).map((p) => p.Id);
    expect(after.families[1]).toMatchObject({ Partner1Id: ids[3], Partner2Id: ids[2], Children: 1 });
  });

  it('re-merging either file afterwards changes nothing', async () => {
    const before = await snapshot(treeId);
    const again = await importGedcomService({ file: ged(GARCIAS), mode: 'merge', currentUserId: USER_ID });
    expect(again.warnings).toEqual([]);
    await importGedcomService({ file: ged(SMITHS), mode: 'merge', currentUserId: USER_ID });
    expect(await snapshot(treeId)).toEqual(before);
  });
});
