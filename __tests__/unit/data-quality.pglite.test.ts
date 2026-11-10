import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { getLikelyDuplicates } from '@/lib/db/queries/data-quality';
import { getSuggestionsService } from '@/lib/services/dashboard';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * #794 (task audit FR-6): "811 likely duplicates" counted every father and son
 * who share a name, and Review opened the unfiltered People list. #822 added
 * family context and spelling variants, and counts pairs.
 */
describe('home suggestion people (PGlite)', () => {
    let mdb: PGlite;
    let treeId: number;
    const person = async (first: string | null, last: string | null, birth: string | null = null, sex: string | null = null) =>
        ((await query(
            `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName", "BirthDate", "Sex") VALUES (1, $1, $2, $3, $4, $5) RETURNING "Id"`,
            [treeId, first, last, birth, sex],
        )).rows[0] as { Id: number }).Id;
    const family = async (husband: number | null, wife: number | null, children: number[] = []) => {
        const id = ((await query(
            `INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id", "Partner2Id") VALUES (1, $1, $2, $3) RETURNING "Id"`,
            [treeId, husband, wife],
        )).rows[0] as { Id: number }).Id;
        for (const c of children) await query(`INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId") VALUES ($1, $2)`, [id, c]);
        return id;
    };
    const event = (personId: number, type: string) =>
        query(`INSERT INTO "Events" ("UserId", "TreeId", "PersonId", "Type") VALUES (1, $1, $2, $3)`, [treeId, personId, type]);

    beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
    beforeEach(async () => {
        await truncateAllTables(mdb);
        await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@example.test', 'g1')`, []);
        treeId = ((await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES (1, 'T') RETURNING "Id"`, [])).rows[0] as { Id: number }).Id;
    });
    afterAll(async () => { __setTestDb(null); await mdb.close(); });

    it('pairs same folded names with birth years within two, in groups, but not a father and son', async () => {
        const father = await person('Jean', 'Fontaine', '1850-03-01');
        await person('Anne', 'Martin', '1901');
        const son = await person('Jean', 'Fontaine', '1875');
        await family(father, null, [son]);
        const etienneA = await person('Étienne', 'Lefèvre', 'ABT 1820');
        const etienneB = await person('Etienne', 'Lefevre', '1822-06-09');
        const undated = await person('Ксения', 'Белозёрова');
        const dated = await person('Ксения', 'Белозерова', '1890');
        // A bare surname is a placeholder, not a match.
        await person(null, 'Smith');
        await person('', 'Smith');

        const { pairs, groups } = await getLikelyDuplicates(treeId);
        expect(groups.flat()).not.toContain(father);
        expect(groups.flat()).not.toContain(son);
        expect(groups).toEqual([[etienneA, etienneB], [dated, undated]]);
        expect(pairs).toHaveLength(2);
    });

    it('matches a given name one letter off, and only within the sex', async () => {
        const a = await person('Rowena', 'Quill', '1801', 'F');
        const b = await person('Rowana', 'Quill', '1801', 'F');
        await person('Aurèle', 'Côté', '1790', 'M');
        await person('Aurélie', 'Côté', '1790', 'F');
        await person('Ivy', 'Marsh', '1800');
        await person('Iva', 'Marsh', '1800');
        expect((await getLikelyDuplicates(treeId)).groups).toEqual([[a, b]]);
    });

    it('does not pair people with different known parents', async () => {
        const [p1, p2, p3, p4] = [await person('Tom', 'Vale'), await person('Ann', 'Hallow'), await person('Ned', 'Vale'), await person('Bea', 'Arbor')];
        const cousinA = await person('Jasper', 'Vale', '1800');
        const cousinB = await person('Jasper', 'Vale', '1801');
        await family(p1, p2, [cousinA]);
        await family(p3, p4, [cousinB]);
        // A married-in spouse with no parents on record can still match.
        const spouse = await person('Jasper', 'Vale', '1799');
        await family(spouse, await person('Wren', 'Marsh'));
        const { pairs } = await getLikelyDuplicates(treeId);
        expect(pairs).toEqual([[cousinA, spouse], [cousinB, spouse]].map(([x, y]) => (x < y ? [x, y] : [y, x])).sort((x, y) => x[0] - y[0] || x[1] - y[1]));
    });

    it('lets an unknown birth year match only with a shared parent or partner, or an unlinked side', async () => {
        const parent = await person('Ned', 'Vale');
        const sibA = await person('Silas', 'Vale');
        const sibB = await person('Silas', 'Vale', '1820');
        await family(parent, null, [sibA, sibB]);
        const otherParent = await person('Ezra', 'Quill');
        const cousin = await person('Silas', 'Vale');
        await family(otherParent, null, [cousin]);
        const loose = await person('Hazel', 'Marsh');
        const linked = await person('Hazel', 'Marsh', '1700');
        await family(null, linked, [await person('Kit', 'Marsh', '1725')]);
        const { pairs } = await getLikelyDuplicates(treeId);
        const has = (x: number, y: number) => pairs.some(([a, b]) => (a === Math.min(x, y) && b === Math.max(x, y)));
        expect(has(sibA, sibB)).toBe(true);
        expect(has(loose, linked)).toBe(true);
        expect(has(cousin, sibA)).toBe(false);
        expect(has(cousin, sibB)).toBe(false);
        expect(pairs).toHaveLength(2);
    });

    it('gives the dashboard the pairs behind the People filter', async () => {
        await person('Jean', 'Fontaine', '1850');
        await person('Jean', 'Fontaine', '1851');
        await person('Jean', 'Fontaine', '1876');
        const busy = await person('Anne', 'Martin');
        await event(busy, 'RESI');

        const suggestions = await getSuggestionsService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: 1 });
        const count = (type: string) => suggestions.find(s => s.type === type)?.count;
        // Counted in pairs (#822): the 1850 and 1851 Jeans, not the 1876 one.
        expect(count('duplicates')).toBe((await getLikelyDuplicates(treeId)).pairs.length);
        expect(count('duplicates')).toBe(1);
        // No missing-parents or no-events suggestions: they can never reach zero (#834).
        expect(suggestions.map(s => s.type)).toEqual(['duplicates']);
    });
});
