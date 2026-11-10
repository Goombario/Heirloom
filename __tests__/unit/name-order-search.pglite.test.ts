import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { searchPeople } from '@/lib/db/queries/people';
import { searchSources } from '@/lib/db/queries/sources';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * A search's LIMIT keeps the first rows by the folded name (#882). Ordered by the
 * raw column, PGlite's C collation kept Banana, Oliver and Zoe here, where hosted
 * Postgres keeps apple, Banana and élan.
 */
const USER_ID = 882882;
const NAMES = ['Banana', 'Oliver', 'Zoe', 'apple', 'zeta', 'Émile', 'Ölund', 'élan', 'Ежов', 'Юрий', 'ёж'];

describe('search keeps the same rows on both engines (#882)', () => {
    let db: PGlite;
    let treeId: number;

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('SELECT 1');
        await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'name-order@test.local', 'name-order']);
        treeId = await resolveDefaultTree(USER_ID);
        for (const name of NAMES) {
            await query('INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName") VALUES ($1, $2, $3, $4)', [USER_ID, treeId, 'Kim', name]);
            await query('INSERT INTO "Sources" ("TreeId", "Title") VALUES ($1, $2)', [treeId, `${name} register`]);
        }
    });

    afterAll(async () => {
        __setTestDb(null);
        await db.close();
    });

    it('runs on the C collation', async () => {
        const { rows } = await query('SELECT datcollate FROM pg_database WHERE datname = current_database()');
        expect(rows[0].datcollate).toBe('C');
    });

    it('people search keeps the first names in folded order', async () => {
        const people = await searchPeople('kim', treeId, 3);
        expect(people.map((p) => p.LastName)).toEqual(['apple', 'Banana', 'élan']);
    });

    it('source search keeps the first titles in folded order', async () => {
        const sources = await searchSources(treeId, 'register');
        expect(sources.slice(0, 3).map((s) => s.Title)).toEqual(['apple register', 'Banana register', 'élan register']);
    });
});
