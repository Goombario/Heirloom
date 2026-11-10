import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// Imported after the mock so the query layer binds to the PGlite connection.
const { getAllFamiliesWithSpouses } = await import('@/lib/db/queries/families');

// Multi-tree: getAllFamiliesWithSpouses is TreeId-scoped, so seeds stamp
// TreeId=1 (the scope the tests query) alongside the legacy UserId.
async function seedFamily(id: number, cols: Partial<{ MarriageDate: string }> = {}) {
  await query(
    `INSERT INTO "Families" ("Id","UserId","TreeId","MarriageDate") VALUES ($1, 1, 1, $2)`,
    [id, cols.MarriageDate ?? null],
  );
}
async function seedFamilyEvent(familyId: number, type: string, date: string | null) {
  await query(
    `INSERT INTO "Events" ("UserId","TreeId","Type","Date","FamilyId") VALUES (1, 1, $1, $2, $3)`,
    [type, date, familyId],
  );
}

describe('getAllFamiliesWithSpouses — derived ended status (PGlite)', () => {
  let mdb: PGlite;
  beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
  beforeEach(async () => { await truncateAllTables(mdb); await query('SELECT 1'); });
  afterAll(async () => { __setTestDb(null); await mdb.close(); });

  it('derives Divorce from a DIV event over the (absent) column', async () => {
    await seedFamily(1, { MarriageDate: '1970' });
    await seedFamilyEvent(1, 'DIV', '1984');
    const [row] = await getAllFamiliesWithSpouses(1);
    expect(row.EndedReason).toBe('Divorce');
    expect(row.EndedDate).toBe('1984');
  });

  it('maps ANUL→Annulment and SEPA→Separation', async () => {
    await seedFamily(2);
    await seedFamilyEvent(2, 'ANUL', '1990');
    await seedFamily(3);
    await seedFamilyEvent(3, 'SEPA', '1991');
    const rows = await getAllFamiliesWithSpouses(1);
    expect(rows.find(r => r.Id === 2)?.EndedReason).toBe('Annulment');
    expect(rows.find(r => r.Id === 3)?.EndedReason).toBe('Separation');
  });

  it('picks the latest end-event when several exist', async () => {
    await seedFamily(4);
    await seedFamilyEvent(4, 'SEPA', '1999');
    await seedFamilyEvent(4, 'DIV', '2001');
    const [row] = await getAllFamiliesWithSpouses(1);
    expect(row.EndedReason).toBe('Divorce');
    expect(row.EndedDate).toBe('2001');
  });

  it('leaves an active family with no end-event unended', async () => {
    await seedFamily(6, { MarriageDate: '2000' });
    const [row] = await getAllFamiliesWithSpouses(1);
    expect(row.EndedReason).toBeNull();
    expect(row.EndedDate).toBeNull();
  });
});
