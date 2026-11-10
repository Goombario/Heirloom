import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { searchPeople } from '@/lib/db/queries/people';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// Search rows name a parent or partner so two "Aster"s can be told apart (#768, DV-4).
describe('searchPeople kin names (PGlite)', () => {
    let mdb: PGlite;
    let treeId: number;
    const person = async (first: string, last: string) =>
        ((await query(`INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName") VALUES (1, $1, $2, $3) RETURNING "Id"`, [treeId, first, last])).rows[0] as { Id: number }).Id;
    const family = async (p1: number | null, p2: number | null) =>
        ((await query(`INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id", "Partner2Id") VALUES (1, $1, $2, $3) RETURNING "Id"`, [treeId, p1, p2])).rows[0] as { Id: number }).Id;

    beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
    beforeEach(async () => {
        await truncateAllTables(mdb);
        await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@example.test', 'g1')`, []);
        treeId = ((await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES (1, 'T') RETURNING "Id"`, [])).rows[0] as { Id: number }).Id;
    });
    afterAll(async () => { __setTestDb(null); await mdb.close(); });

    it('returns the parents of a child and the partner of a spouse', async () => {
        const father = await person('Rowan', 'Arbor');
        const mother = await person('Hazel', 'Bracken');
        const child = await person('Aster', 'Arbor');
        const spouse = await person('Aster', 'Vale');
        const other = await person('Linden', 'Vale');
        const parents = await family(father, mother);
        await query(`INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId") VALUES ($1, $2)`, [parents, child]);
        await family(spouse, other);

        const rows = await searchPeople('Aster', treeId);
        const byId = new Map(rows.map((r) => [r.Id, r]));
        expect(byId.get(child)).toMatchObject({ ParentName1: 'Rowan Arbor', ParentName2: 'Hazel Bracken', PartnerName: null });
        expect(byId.get(spouse)).toMatchObject({ ParentName1: null, ParentName2: null, PartnerName: 'Linden Vale' });
    });
});
