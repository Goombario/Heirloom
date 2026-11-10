import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

const { getEventsByPersonIdsAndType } = await import('@/lib/db/queries/events');
const { getCitationsForFamily } = await import('@/lib/db/queries/citations');

const person = async (first: string, treeId = 1) =>
  (await query(`INSERT INTO "People" ("FirstName", "LastName", "TreeId") VALUES ($1, 'Bracken', $2) RETURNING "Id"`, [first, treeId])).rows[0].Id as number;
const personEvent = async (personId: number, type: string, date: string, treeId = 1) =>
  (await query(`INSERT INTO "Events" ("UserId", "TreeId", "Type", "Date", "PersonId") VALUES (1, $1, $2, $3, $4) RETURNING "Id"`, [treeId, type, date, personId])).rows[0].Id as number;

// A child's adoption is their own ADOP event; the family timeline shows it (#485).
describe('family timeline adoptions (PGlite, #485)', () => {
  let mdb: PGlite;
  beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
  beforeEach(async () => {
    await truncateAllTables(mdb);
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@example.test', 'g1')`, []);
    await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Brackens'), (2, 1, 'Other')`, []);
  });
  afterAll(async () => { __setTestDb(null); await mdb.close(); });

  it('reads only the asked type, for only the asked people, in this tree', async () => {
    const hazel = await person('Hazel');
    const tom = await person('Tom');
    const adop = await personEvent(hazel, 'ADOP', '1931');
    await personEvent(hazel, 'BAPM', '1930');
    await personEvent(tom, 'ADOP', '1935');
    const elsewhere = await person('Other', 2);
    await personEvent(elsewhere, 'ADOP', '1940', 2);

    const rows = await getEventsByPersonIdsAndType([hazel, elsewhere], 'ADOP', 1);
    expect(rows.map((r) => r.Id)).toEqual([adop]);
    expect(await getEventsByPersonIdsAndType([], 'ADOP', 1)).toEqual([]);
  });

  it('loads the citations on a child\'s adoption with the family\'s', async () => {
    await query(`INSERT INTO "Families" ("Id", "UserId", "TreeId") VALUES (7, 1, 1)`, []);
    const hazel = await person('Hazel');
    const outsider = await person('Outsider');
    await query(`INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId") VALUES (7, $1)`, [hazel]);
    const adop = await personEvent(hazel, 'ADOP', '1931');
    const bapm = await personEvent(hazel, 'BAPM', '1930');
    const otherAdop = await personEvent(outsider, 'ADOP', '1931');
    const src = (await query(`INSERT INTO "Sources" ("Title", "TreeId") VALUES ('Court order', 1) RETURNING "Id"`, [])).rows[0].Id as number;
    for (const factId of [adop, bapm, otherAdop]) {
      await query(`INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId") VALUES (1, 1, 'Events', $1, $2)`, [factId, src]);
    }

    const keys = (await getCitationsForFamily(7, 1)).map((g) => g.key);
    expect(keys).toEqual([`Events:${adop}`]);
  });
});
