import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import {
    deleteSavedSearchService, listSavedSearchesService, saveSearchService, searchPeopleService,
} from '@/lib/services/advanced-search';
import { encodeQuery, decodeQuery, type SearchQuery } from '@/lib/search/people-query';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// #247 (ADR 0054): advanced search reads a real tree through each slice's SQL, and
// saved searches are each member's own.

const OWNER = 24701;
const OTHER = 24702;
const GED = [
    '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME James /Smith/', '1 SEX M', '1 DEAT', '2 DATE 2 MAY 1939', '2 PLAC London, England', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME Agnes /Whitfield/', '1 SEX F', '1 DEAT', '2 DATE ABT 1940', '1 FAMS @F1@',
    '1 NOTE Kept the family bible.',
    '0 @I3@ INDI', '1 NAME Clara /Smith/', '1 SEX F', '1 FAMC @F1@', '1 OCCU Teacher',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 MARR', '2 DATE 1895',
    '0 TRLR',
].join('\n');

let db: PGlite;
let treeId: number;
const scope = (currentUserId = OWNER) => ({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId });
const idOf = async (first: string) => ((await query(`SELECT "Id" FROM "People" WHERE "TreeId" = $1 AND "FirstName" = $2`, [treeId, first])).rows[0] as { Id: number }).Id;
const names = async (ids: number[] | null) => {
    if (!ids) return null;
    const res = await query(`SELECT "FirstName" FROM "People" WHERE "Id" = ANY($1::int[]) ORDER BY "FirstName"`, [ids]);
    return (res.rows as Array<{ FirstName: string }>).map((r) => r.FirstName);
};
const q = (...conds: SearchQuery['groups'][number]['conds']): SearchQuery => ({ groups: [{ match: 'all', conds }] });

beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
    await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3), ($4, $5, $6)',
        [OWNER, 'search@test.local', 'search-owner', OTHER, 'other@test.local', 'search-other']);
    treeId = await resolveDefaultTree(OWNER);
    await importGedcomService({ file: new File([GED], 'tree.ged'), mode: 'overwrite', currentUserId: OWNER });
});

afterAll(async () => {
    __setTestDb(null);
    await db.close();
});

describe('advanced search service (#247)', () => {
    it('evaluates dates, places, notes, events and relationships over the tree', async () => {
        const search = async (query: SearchQuery) => names((await searchPeopleService({ ...scope(), query })).ids);
        expect(await search(q({ field: 'death_date', op: 'between', v: '1939', v2: '1945' }))).toEqual(['Agnes', 'James']);
        expect(await search(q({ field: 'death_place', op: 'is_in', v: 'England' }))).toEqual(['James']);
        expect(await search(q({ field: 'notes', op: 'contains', v: 'bible' }))).toEqual(['Agnes']);
        expect(await search(q({ field: 'event_type', op: 'has', v: 'MARR' }))).toEqual(['Agnes', 'James']);
        expect(await search(q({ field: 'parents', op: 'has' }))).toEqual(['Clara']);
        const james = await idOf('James');
        expect(await search(q({ field: 'relationship', op: 'related', id: james, rel: 'descendant', marriage: true, steps: 6 }))).toEqual(['Clara']);
    });

    it('explains an empty result with each condition left out', async () => {
        const r = await searchPeopleService({
            ...scope(),
            query: q({ field: 'sex', op: 'is', v: 'M' }, { field: 'notes', op: 'has' }),
            explain: true,
        });
        expect(r.ids).toEqual([]);
        expect(r.count).toBe(0);
        // Without "is male": Agnes. Without "has notes": James.
        expect(r.without).toEqual([1, 1]);
    });

    it('counts everyone when the query has no conditions', async () => {
        const r = await searchPeopleService({ ...scope(), query: { groups: [] } });
        expect(r.ids).toBeNull();
        expect(r.count).toBe(3);
    });

    it('keeps saved searches per member, with a live count', async () => {
        const smiths = q({ field: 'surname', op: 'is', v: 'Smith' });
        await expect(saveSearchService({ ...scope(), name: '  ', query: smiths })).rejects.toThrow(/name is required/);
        await expect(saveSearchService({ ...scope(), name: 'Empty', query: { groups: [] } })).rejects.toThrow(/no conditions/);
        const { id } = await saveSearchService({ ...scope(), name: ' Smiths ', query: smiths });

        const mine = await listSavedSearchesService(scope());
        expect(mine).toEqual([{ id, name: 'Smiths', query: smiths, count: 2 }]);

        // A shared link carries the query, not the saved row.
        expect(decodeQuery(encodeQuery(smiths))).toEqual(smiths);

        // Another member sees none of the owner's, and can't delete them.
        await query(`INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "TreeId", "Permission") VALUES ($1, $2, $3, 'view')`, [OWNER, OTHER, treeId]);
        expect(await listSavedSearchesService(scope(OTHER))).toEqual([]);
        await expect(deleteSavedSearchService({ ...scope(OTHER), id })).rejects.toThrow(/not found/i);

        await deleteSavedSearchService({ ...scope(), id });
        expect(await listSavedSearchesService(scope())).toEqual([]);

        // A member keeps at most 50 per tree.
        for (let i = 0; i < 50; i++) await saveSearchService({ ...scope(), name: `S${i}`, query: smiths });
        await expect(saveSearchService({ ...scope(), name: 'One more', query: smiths })).rejects.toThrow(/up to 50/);
    });
});
