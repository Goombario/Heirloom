import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { getPersonWithRelations } from '@/lib/db/queries/people';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

const TREE = 1;

async function seedTree() {
  await query(
    `INSERT INTO "Users" ("Id","Email","Name","GoogleId") VALUES (1,'local@web','Local User','local-web')
     ON CONFLICT ("Id") DO NOTHING`,
    [],
  );
  await query(`INSERT INTO "Trees" ("Id","OwnerId","Name") VALUES ($1,1,'My Tree') ON CONFLICT ("Id") DO NOTHING`, [TREE]);
}

async function person(id: number, first: string, birth: string | null = null) {
  await query(
    `INSERT INTO "People" ("Id","UserId","TreeId","FirstName","LastName","BirthDate") VALUES ($1,1,$2,$3,'Thornbury',$4)`,
    [id, TREE, first, birth],
  );
}

async function family(id: number, p1: number | null, p2: number | null, marriageDate: string | null) {
  await query(
    `INSERT INTO "Families" ("Id","UserId","TreeId","Partner1Id","Partner2Id","MarriageDate") VALUES ($1,1,$2,$3,$4,$5)`,
    [id, TREE, p1, p2, marriageDate],
  );
}

async function child(familyId: number, childId: number, type = 'Birth') {
  await query(
    `INSERT INTO "FamilyPerson" ("FamiliesAsChildId","ChildrenId","Partner1Relationship","Partner2Relationship") VALUES ($1,$2,$3,$3)`,
    [familyId, childId, type],
  );
}

/**
 * #481 — the relationships pane reads positionally: every heading applies to the
 * rows beneath it until the next one. That makes the ORDER these come back in
 * load-bearing, and none of the three family queries used to carry an ORDER BY.
 */
describe('getPersonWithRelations union ordering and provenance (PGlite)', () => {
  let mdb: PGlite;
  beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
  beforeEach(async () => { await truncateAllTables(mdb); await query('SELECT 1'); });
  afterAll(async () => { __setTestDb(null); await mdb.close(); });

  it('orders unions chronologically regardless of which side of the family the person is on', async () => {
    await seedTree();
    await person(1, 'Bruce');
    await person(2, 'Susan');
    await person(3, 'Cindy');
    await person(4, 'Ingrid', '1995-01-01');
    // The later marriage puts Bruce on Partner1; the earlier, undated partnership
    // puts him on Partner2 — the two are fetched by separate queries, so a plain
    // concatenation used to render the 2017 union first.
    await family(10, 3, 1, '2017-06-01');
    await family(11, 2, 1, null);
    await child(11, 4);

    const p = await getPersonWithRelations(1, TREE);
    expect(p?.spouses?.map((s) => s.person?.FirstName)).toEqual(['Susan', 'Cindy']);
  });

  it('dates an undated union from its earliest child', async () => {
    await seedTree();
    await person(1, 'Bruce');
    await person(2, 'Susan');
    await person(3, 'Cindy');
    await person(4, 'Ingrid', '1995-01-01');
    await family(10, 1, 3, '2017-06-01');
    await family(11, 1, 2, null);
    await child(11, 4);

    const p = await getPersonWithRelations(1, TREE);
    // Without the child fallback the undated union sorts last, below a 2017
    // marriage, even though its children were born in the 1990s.
    expect(p?.spouses?.map((s) => s.person?.FirstName)).toEqual(['Susan', 'Cindy']);
  });

  it('keeps familiesAsSpouse in the same order as spouses', async () => {
    await seedTree();
    await person(1, 'Bruce');
    await person(2, 'Susan');
    await person(3, 'Cindy');
    await family(10, 3, 1, '2017-06-01');
    await family(11, 2, 1, '1990-01-01');

    const p = await getPersonWithRelations(1, TREE);
    expect(p?.familiesAsSpouse?.map((f) => f.Id)).toEqual(p?.spouses?.map((s) => s.family.Id));
  });

  it('attributes siblings to the parent family they come through', async () => {
    await seedTree();
    await person(1, 'Bruce');
    await person(2, 'Edmund');
    await person(3, 'Helen');
    await person(4, 'Judith');
    await person(5, 'Henry');
    await person(6, 'Stepsib');
    await family(10, 2, 3, '1950-01-01');
    await family(11, 5, null, null);
    await child(10, 1);
    await child(10, 4);
    await child(11, 1, 'Adoption');
    await child(11, 6);

    const p = await getPersonWithRelations(1, TREE);
    const byFamily = Object.fromEntries((p?.parents ?? []).map((r) => [r.family.Id, r]));
    expect(byFamily[10].siblings.map((s) => s.FirstName)).toEqual(['Judith']);
    expect(byFamily[11].siblings.map((s) => s.FirstName)).toEqual(['Stepsib']);
    // The flat list still carries every sibling, for callers that want them all.
    expect((p?.siblings ?? []).map((s) => s.FirstName).sort()).toEqual(['Judith', 'Stepsib']);
  });

  it("carries the child's link type so an adoptive family can be named as one", async () => {
    await seedTree();
    await person(1, 'Bruce');
    await person(2, 'Edmund');
    await person(5, 'Henry');
    await family(10, 2, null, null);
    await family(11, 5, null, null);
    await child(10, 1, 'Birth');
    await child(11, 1, 'Adoption');

    const p = await getPersonWithRelations(1, TREE);
    const types = Object.fromEntries((p?.parents ?? []).map((r) => [r.family.Id, r.partner1Relationship]));
    expect(types[10]).toBe('Birth');
    expect(types[11]).toBe('Adoption');
  });
});
