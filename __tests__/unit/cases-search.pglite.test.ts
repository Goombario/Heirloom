import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { getAllCases } from '@/lib/db/queries/cases';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// Cases search matches every word against the title, tags or description,
// accent-folded, and still combines with the tag and status filters (#915).
describe('getAllCases search (PGlite)', () => {
    let mdb: PGlite;
    let treeId: number;
    const kase = (title: string, tags: string[], description: string | null = null, status = 'in_progress') =>
        query(`INSERT INTO "Cases" ("UserId", "TreeId", "Title", "Description", "Status", "Tags") VALUES (1, $1, $2, $3, $4, $5)`, [treeId, title, description, status, tags]);
    const titles = async (filters: Parameters<typeof getAllCases>[1]) =>
        (await getAllCases(treeId, filters)).map((c) => c.Title).sort();

    beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
    beforeEach(async () => {
        await truncateAllTables(mdb);
        await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@example.test', 'g1')`, []);
        treeId = ((await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES (1, 'T') RETURNING "Id"`, [])).rows[0] as { Id: number }).Id;
        await kase('Who was Alder Arbor\'s father?', ['parentage', 'census'], 'Two baptisms disagree.');
        await kase('Étienne\'s emigration', ['immigration'], 'Ship lists from Le Havre.');
        await kase('Closed parentage question', ['Parentage'], null, 'closed');
        await kase('Rate 100% sure', []);
    });
    afterAll(async () => { __setTestDb(null); await mdb.close(); });

    it('matches a title, a tag or the description', async () => {
        expect(await titles({ search: 'Arbor' })).toEqual(['Who was Alder Arbor\'s father?']);
        expect(await titles({ search: 'immigration' })).toEqual(['Étienne\'s emigration']);
        expect(await titles({ search: 'Havre' })).toEqual(['Étienne\'s emigration']);
        expect(await titles({ search: 'PARENT' })).toEqual(['Closed parentage question', 'Who was Alder Arbor\'s father?']);
    });

    it('requires every word to match somewhere', async () => {
        expect(await titles({ search: 'parentage Arbor' })).toEqual(['Who was Alder Arbor\'s father?']);
        expect(await titles({ search: 'parentage Havre' })).toEqual([]);
    });

    it('folds accents on both sides', async () => {
        expect(await titles({ search: 'Etienne' })).toEqual(['Étienne\'s emigration']);
        expect(await titles({ search: 'étienne' })).toEqual(['Étienne\'s emigration']);
    });

    it('keeps "%" and "_" literal', async () => {
        expect(await titles({ search: '100%' })).toEqual(['Rate 100% sure']);
        expect(await titles({ search: '_' })).toEqual([]);
    });

    it('combines with the tag and status filters', async () => {
        expect(await titles({ search: 'parentage', tag: 'census' })).toEqual(['Who was Alder Arbor\'s father?']);
        expect(await titles({ search: 'parentage', status: 'closed' })).toEqual(['Closed parentage question']);
    });
});
