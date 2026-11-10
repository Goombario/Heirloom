import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

const { getCitedByForSource } = await import('@/lib/db/queries/citations');

// "What this source proves" used to come back in table-name and row-id order (#911).
describe('getCitedByForSource order (PGlite, #911)', () => {
  let mdb: PGlite;
  beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
  beforeEach(async () => {
    await truncateAllTables(mdb);
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@example.test', 'g1')`, []);
    await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Brackens')`, []);
  });
  afterAll(async () => { __setTestDb(null); await mdb.close(); });

  it('orders by the fact\'s year (births, deaths, marriages, events), undated last, and returns the key', async () => {
    const person = async (first: string, birth: string | null, death: string | null) =>
      (await query(`INSERT INTO "People" ("FirstName", "LastName", "TreeId", "BirthDate", "DeathDate") VALUES ($1, 'Bracken', 1, $2, $3) RETURNING "Id"`, [first, birth, death])).rows[0].Id as number;
    const hazel = await person('Hazel', 'ABT 1901', '1980');
    const tom = await person('Tom', '1870', null);
    const fam = (await query(`INSERT INTO "Families" ("UserId", "TreeId", "MarriageDate") VALUES (1, 1, '1895') RETURNING "Id"`, [])).rows[0].Id as number;
    const cens = (await query(`INSERT INTO "Events" ("UserId", "TreeId", "Type", "Date", "PersonId") VALUES (1, 1, 'CENS', '1911', $1) RETURNING "Id"`, [hazel])).rows[0].Id as number;
    const src = (await query(`INSERT INTO "Sources" ("Title", "TreeId") VALUES ('Register', 1) RETURNING "Id"`, [])).rows[0].Id as number;
    const cite = (table: string, id: number) => query(`INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId") VALUES (1, 1, $1, $2, $3)`, [table, id, src]);
    await cite('PersonDeath', hazel);
    await cite('People', tom);
    await cite('Events', cens);
    await cite('PersonBirth', hazel);
    await cite('Families', fam);
    await cite('PersonBirth', tom);

    const rows = await getCitedByForSource(src, 1);
    expect(rows.map((r) => [r.factTable, r.sortableYear])).toEqual([
      ['PersonBirth', 1870],
      ['Families', 1895],
      ['PersonBirth', 1901],
      ['Events', 1911],
      ['PersonDeath', 1980],
      ['People', null],
    ]);
    expect(rows[1].factDate).toBe('1895');
  });
});
