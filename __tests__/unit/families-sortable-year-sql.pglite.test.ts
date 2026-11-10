import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { getAllFamiliesWithSpouses } from '@/lib/db/queries/families';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * `getAllFamiliesWithSpouses` picks the ended-event date via a LATERAL LIMIT 1
 * ordered by extracted year, and counts young child deaths via a FILTER that
 * subtracts extracted years. Both used to read a year out of prose with a raw
 * `substring(... FROM '\d{4}')`; a phrase date's stray digits (e.g. "1990" out
 * of "(the 1990s)") would then out-rank or mis-count a real date. Both call
 * sites now go through the shared `"SortableYear"` SQL function instead (#490, ADR 0016).
 */
describe('getAllFamiliesWithSpouses: shared year rule at both call sites', () => {
  let mdb: PGlite;
  const U = 9001;
  const T = 9001;
  let familyAId: number;
  let familyCId: number;

  beforeAll(async () => {
    mdb = await newEmptyClusterDb();
    __setTestDb(mdb);
    await query('SELECT 1'); // triggers the lazy schema init gate

    await mdb.query(
      'INSERT INTO "Users" ("Id","Email","GoogleId") VALUES ($1,$2,$3)',
      [U, 'families-sortable-year@test.local', 'google-families-sortable-year'],
    );
    await mdb.query(
      'INSERT INTO "Trees" ("Id","OwnerId","Name") VALUES ($1,$2,$3)',
      [T, U, 'Families SortableYear Fixture'],
    );

    // Family A: an ended-event whose only date is a phrase, and one with a
    // real year. The real one must win the LATERAL ORDER BY.
    const famA = await mdb.query<{ Id: number }>(
      `INSERT INTO "Families" ("UserId","TreeId") VALUES ($1,$2) RETURNING "Id"`,
      [U, T],
    );
    familyAId = famA.rows[0].Id;
    await mdb.query(
      `INSERT INTO "Events" ("UserId","TreeId","Type","Date","FamilyId") VALUES ($1,$2,'DIV',$3,$4)`,
      [U, T, '(the 1990s)', familyAId],
    );
    await mdb.query(
      `INSERT INTO "Events" ("UserId","TreeId","Type","Date","FamilyId") VALUES ($1,$2,'DIV',$3,$4)`,
      [U, T, '1975', familyAId],
    );

    // Family B: unrelated second family, just to prove the query still scopes
    // and returns multiple rows correctly.
    const famB = await mdb.query<{ Id: number }>(
      `INSERT INTO "Families" ("UserId","TreeId") VALUES ($1,$2) RETURNING "Id"`,
      [U, T],
    );
    const familyBId = famB.rows[0].Id;
    await mdb.query(
      `INSERT INTO "Events" ("UserId","TreeId","Type","Date","FamilyId") VALUES ($1,$2,'SEPA',$3,$4)`,
      [U, T, '1960', familyBId],
    );

    // Family C: two children, one with a phrase birth date and a real death
    // date (must NOT count as a young death), one with real dates under 18
    // apart (must count).
    const famC = await mdb.query<{ Id: number }>(
      `INSERT INTO "Families" ("UserId","TreeId") VALUES ($1,$2) RETURNING "Id"`,
      [U, T],
    );
    familyCId = famC.rows[0].Id;
    const phraseChild = await mdb.query<{ Id: number }>(
      `INSERT INTO "People" ("UserId","TreeId","FirstName","LastName","BirthDate","DeathDate")
       VALUES ($1,$2,'Phrase','Child',$3,$4) RETURNING "Id"`,
      [U, T, '(born in the 1850s)', '1860'],
    );
    const realYoungChild = await mdb.query<{ Id: number }>(
      `INSERT INTO "People" ("UserId","TreeId","FirstName","LastName","BirthDate","DeathDate")
       VALUES ($1,$2,'Real','Child',$3,$4) RETURNING "Id"`,
      [U, T, '1900', '1905'],
    );
    await mdb.query(
      `INSERT INTO "FamilyPerson" ("FamiliesAsChildId","ChildrenId") VALUES ($1,$2)`,
      [familyCId, phraseChild.rows[0].Id],
    );
    await mdb.query(
      `INSERT INTO "FamilyPerson" ("FamiliesAsChildId","ChildrenId") VALUES ($1,$2)`,
      [familyCId, realYoungChild.rows[0].Id],
    );

  });
  afterAll(async () => { __setTestDb(null); await mdb.close(); });

  it('orders the ended-event lateral by the real date, not a phrase\'s stray digits', async () => {
    const rows = await getAllFamiliesWithSpouses(T);
    const familyA = rows.find((f) => f.Id === familyAId);
    expect(familyA).toBeDefined();
    expect(familyA!.EndedDate).toBe('1975');
    expect(familyA!.EndedReason).toBe('Divorce');
  });

  it('excludes a phrase-dated child from young_death_count', async () => {
    const rows = await getAllFamiliesWithSpouses(T);
    const familyC = rows.find((f) => f.Id === familyCId);
    expect(familyC).toBeDefined();
    // Only the real-dated child (1900-1905, 5 years) counts; the phrase-dated
    // child (born-in-the-1850s / 1860) must not, even though a raw digit read
    // of "1850" against "1860" would also look like a young death.
    expect(familyC!.youngDeathCount).toBe(1);
    expect(familyC!.childCount).toBe(2);
  });
});
