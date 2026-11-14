import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { createCitationsService, listCitationsForFamilyService } from '@/lib/services/citations';
import { listRecentlyCitedSourcesService } from '@/lib/services/sources';
import type { CreateCitationsInput } from '@/lib/data/types';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * Citing one source on a household (#799, EV-7): the bulk write is one
 * transaction, checks every fact against the tree first, and audits each row.
 */
describe('bulk citation (PGlite)', () => {
    let mdb: PGlite;
    let treeId: number;
    let otherTreeId: number;
    let sourceId: number;
    let father: number;
    let children: number[];

    const id = (rows: unknown[]) => (rows[0] as { Id: number }).Id;
    const person = async (tree: number, first: string) =>
        id((await query(`INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName") VALUES (1, $1, $2, 'Bracken') RETURNING "Id"`, [tree, first])).rows);
    const cite = (input: Omit<CreateCitationsInput, 'SourceId'> & { SourceId?: number }) =>
        createCitationsService({ input: { SourceId: sourceId, ...input }, requestedTreeId: treeId, requestedOwnerId: null, currentUserId: 1 });
    const count = async (table: string) => ((await query(`SELECT COUNT(*)::int AS n FROM "${table}"`, [])).rows[0] as { n: number }).n;

    beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
    beforeEach(async () => {
        await truncateAllTables(mdb);
        await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@example.test', 'g1')`, []);
        treeId = id((await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES (1, 'T') RETURNING "Id"`, [])).rows);
        otherTreeId = id((await query(`INSERT INTO "Trees" ("OwnerId", "Name") VALUES (1, 'Other') RETURNING "Id"`, [])).rows);
        sourceId = id((await query(`INSERT INTO "Sources" ("OwnerId", "TreeId", "Title", "Type") VALUES (1, $1, '1901 Census, household 12', 'Census') RETURNING "Id"`, [treeId])).rows);
        father = await person(treeId, 'Tom');
        children = [await person(treeId, 'Ann'), await person(treeId, 'Ben'), await person(treeId, 'Cal')];
    });
    afterAll(async () => { __setTestDb(null); await mdb.close(); });

    it('cites a father and three children in one call, with shared and per-row detail', async () => {
        const created = await cite({
            Page: 'Folio 3',
            Quay: '3',
            DataText: 'Head, 42, labourer',
            facts: [
                { FactTable: 'PersonBirth', FactId: father },
                ...children.map((c, i) => ({ FactTable: 'PersonBirth' as const, FactId: c, Page: i === 0 ? 'Folio 3, line 9' : null })),
            ],
        });
        expect(created).toHaveLength(4);
        expect(created.every(c => c.SourceId === sourceId && c.TreeId === treeId && c.OwnerId === 1 && c.Quay === '3')).toBe(true);
        expect(created.map(c => c.Page)).toEqual(['Folio 3', 'Folio 3, line 9', 'Folio 3', 'Folio 3']);
        const audits = (await query(`SELECT "EntityId" FROM "AuditLog" WHERE "EntityType" = 'citation' AND "Action" = 'create' ORDER BY "EntityId"`, [])).rows as { EntityId: number }[];
        expect(audits.map(a => a.EntityId)).toEqual(created.map(c => c.Id).sort((a, b) => a - b));
    });

    it('cites a fact listed twice only once', async () => {
        const created = await cite({ facts: [{ FactTable: 'PersonBirth', FactId: father }, { FactTable: 'PersonBirth', FactId: father }] });
        expect(created).toHaveLength(1);
    });

    it('writes nothing when one fact belongs to another tree', async () => {
        const stranger = await person(otherTreeId, 'Zed');
        await expect(cite({ facts: [{ FactTable: 'PersonBirth', FactId: father }, { FactTable: 'PersonBirth', FactId: stranger }] }))
            .rejects.toThrow(/not found in this tree/);
        expect(await count('Citation')).toBe(0);
        expect(await count('AuditLog')).toBe(0);
    });

    it('treats a fractional or out-of-range id as not found, not a crash', async () => {
        const { factIdsInTree } = await import('@/lib/db/queries/citations');
        await expect(factIdsInTree('PersonBirth', [1.5, 3_000_000_000, father], treeId)).resolves.toEqual(new Set([father]));
    });

    it('rejects a source from another tree', async () => {
        const foreign = id((await query(`INSERT INTO "Sources" ("OwnerId", "TreeId", "Title") VALUES (1, $1, 'Elsewhere') RETURNING "Id"`, [otherTreeId])).rows);
        await expect(cite({ SourceId: foreign, facts: [{ FactTable: 'PersonBirth', FactId: father }] })).rejects.toThrow(/Source not found/);
    });

    it('gives every created citation the shared record link (#41)', async () => {
        const created = await cite({
            Url: ' https://example.test/census/12 ',
            facts: [{ FactTable: 'PersonBirth', FactId: father }, { FactTable: 'PersonBirth', FactId: children[0] }],
        });
        expect(created.map(c => c.Url)).toEqual(['https://example.test/census/12', 'https://example.test/census/12']);
    });

    it('writes nothing when the record link has a line break or is too long (#41)', async () => {
        const facts = [{ FactTable: 'PersonBirth' as const, FactId: father }];
        await expect(cite({ Url: 'https://example.test/a\nb', facts })).rejects.toThrow(/single line/);
        await expect(cite({ Url: `https://example.test/${'x'.repeat(4096)}`, facts })).rejects.toThrow(/at most/);
        expect(await count('Citation')).toBe(0);
    });

    it('rejects case facts, a bad certainty, and an empty list', async () => {
        await expect(cite({ facts: [{ FactTable: 'Cases', FactId: 1 }] })).rejects.toThrow(/Invalid FactTable/);
        await expect(cite({ Quay: '7', facts: [{ FactTable: 'PersonBirth', FactId: father }] })).rejects.toThrow(/Invalid Quay/);
        await expect(cite({ facts: [] })).rejects.toThrow(/non-empty/);
        expect(await count('Citation')).toBe(0);
    });

    it("returns the children's birth citations with the family's, for its timeline pins", async () => {
        const family = id((await query(`INSERT INTO "Families" ("UserId", "TreeId", "Partner1Id") VALUES (1, $1, $2) RETURNING "Id"`, [treeId, father])).rows);
        for (const c of children) {
            await query(`INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId") VALUES ($1, $2)`, [family, c]);
        }
        await cite({ facts: [{ FactTable: 'PersonBirth', FactId: father }, ...children.map(c => ({ FactTable: 'PersonBirth' as const, FactId: c }))] });
        const map = await listCitationsForFamilyService({ familyId: family, requestedTreeId: treeId, requestedOwnerId: null, currentUserId: 1 });
        // The children's births, not the father's: he is a partner, whose birth the timeline doesn't show.
        expect(Object.keys(map).sort()).toEqual(children.map(c => `PersonBirth:${c}`).sort());
    });

    it('lists the most recently cited sources first', async () => {
        const older = id((await query(`INSERT INTO "Sources" ("OwnerId", "TreeId", "Title") VALUES (1, $1, 'Parish register') RETURNING "Id"`, [treeId])).rows);
        await query(`INSERT INTO "Sources" ("OwnerId", "TreeId", "Title") VALUES (1, $1, 'Never cited')`, [treeId]);
        await cite({ SourceId: older, facts: [{ FactTable: 'PersonBirth', FactId: father }] });
        await cite({ facts: [{ FactTable: 'PersonBirth', FactId: children[0] }] });
        const recent = await listRecentlyCitedSourcesService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: 1 });
        expect(recent.map(s => s.Id)).toEqual([sourceId, older]);
    });
});
