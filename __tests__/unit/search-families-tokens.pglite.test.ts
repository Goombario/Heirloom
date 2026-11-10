import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { searchFamilies } from '@/lib/db/queries/families';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// Family search matches every word against either partner, and drops the "&"
// the app itself shows between partners (#910).
describe('searchFamilies tokens (PGlite)', () => {
    let mdb: PGlite;
    let treeId: number;
    let couple: number;
    let single: number;
    const person = async (first: string, last: string) =>
        ((await query(`INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName") VALUES (1, $1, $2, $3) RETURNING "Id"`, [treeId, first, last])).rows[0] as { Id: number }).Id;
    const family = async (p1: number | null, p2: number | null) =>
        ((await query(`INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id", "Partner2Id") VALUES (1, $1, $2, $3) RETURNING "Id"`, [treeId, p1, p2])).rows[0] as { Id: number }).Id;
    const ids = async (q: string) => (await searchFamilies(q, treeId)).map((f) => f.Id);

    beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
    beforeEach(async () => {
        await truncateAllTables(mdb);
        await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@example.test', 'g1')`, []);
        treeId = ((await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES (1, 'T') RETURNING "Id"`, [])).rows[0] as { Id: number }).Id;
        const alder = await person('Alder', 'Arbor');
        const delphine = await person('Delphine', 'Underhay');
        // Created first, so a plain Id order would list it ahead of the couple.
        single = await family(await person('Alder', 'Vale'), null);
        couple = await family(alder, delphine);
        await query(
            `INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name") VALUES (1, $1, $2, 'nickname', 'Del'), (1, $1, $2, 'married', 'Étoile')`,
            [treeId, delphine],
        );
    });
    afterAll(async () => { __setTestDb(null); await mdb.close(); });

    it.each(['Alder', 'Delphine', 'Arbor'])('finds the couple by one partner (%s)', async (q) => {
        expect(await ids(q)).toContain(couple);
    });

    it.each([
        'Alder & Delphine',
        'Alder Arbor & Delphine Underhay',
        'Alder Delphine',
        'Arbor Underhay',
        'Arbor Alder',
        'Alder and Delphine',
        'Alder+Delphine',
        'alder&delphine',
    ])('finds the couple across partners (%s)', async (q) => {
        expect(await ids(q)).toEqual([couple]);
    });

    it('finds nothing for a query of only separators', async () => {
        expect(await ids('&')).toEqual([]);
        expect(await ids(' + and ')).toEqual([]);
    });

    it('matches either partner\'s name variants, folded', async () => {
        expect(await ids('Alder Del')).toEqual([couple]);
        expect(await ids('Etoile')).toEqual([couple]);
    });

    it('ranks couples where both partners matched first', async () => {
        // "Vale" matches one partner of the older family and both of the newer one.
        const both = await family(await person('Rowan', 'Vale'), await person('Hazel', 'Vale'));
        expect(await ids('Vale')).toEqual([both, single]);
        // Ties keep creation order.
        expect(await ids('Alder')).toEqual([single, couple]);
    });
});
