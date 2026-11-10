import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// Imported after the mock so the query layer binds to the PGlite connection.
const { findMediaByHashes } = await import('@/lib/db/queries/media');

/**
 * The duplicate lookup runs against BOTH engines: real Postgres on the hosted
 * build and PGlite in the static/Tauri one, where `LocalMediaClient` calls the
 * service directly. `= ANY($2)` binding a JS array is the kind of thing that can
 * behave differently between the two, and a silent divergence here would mean
 * the guard quietly never matching on desktop — precisely the hosted/local split
 * this feature was designed to avoid (#592).
 */
async function seedMedia(id: number, hash: string | null, treeId = 1, title = 'Photo') {
    await query(
        `INSERT INTO "Media" ("Id","UserId","TreeId","Title","FilePath","Format","ContentType","FileSize","ContentHash")
         VALUES ($1, 1, $2, $3, 'x.jpg', 'JPG', 'image/jpeg', 10, $4)`,
        [id, treeId, title, hash],
    );
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('findMediaByHashes (PGlite)', () => {
    let mdb: PGlite;
    beforeAll(async () => { mdb = await newEmptyClusterDb(); __setTestDb(mdb); await query('SELECT 1'); });
    beforeEach(async () => { await truncateAllTables(mdb); await query('SELECT 1'); });
    afterAll(async () => { __setTestDb(null); await mdb.close(); });

    it('binds a JS array to = ANY() and finds the match', async () => {
        await seedMedia(1, HASH_A, 1, 'Wedding portrait, 1961');
        const matches = await findMediaByHashes([HASH_A, HASH_B], 1);
        expect(matches).toHaveLength(1);
        expect(matches[0].Id).toBe(1);
        expect(matches[0].Title).toBe('Wedding portrait, 1961');
    });

    it('stays inside the tree', async () => {
        await seedMedia(1, HASH_A, 2);
        expect(await findMediaByHashes([HASH_A], 1)).toEqual([]);
    });

    it('never matches a NULL hash', async () => {
        await seedMedia(1, null, 1);
        expect(await findMediaByHashes([HASH_A], 1)).toEqual([]);
    });

    it('collapses several copies of one hash to the earliest row', async () => {
        await seedMedia(1, HASH_A, 1, 'First copy');
        await seedMedia(2, HASH_A, 1, 'Second copy');
        const matches = await findMediaByHashes([HASH_A], 1);
        expect(matches).toHaveLength(1);
        expect(matches[0].Title).toBe('First copy');
    });

    it('the ContentHash column exists on a freshly initialised local database', async () => {
        const res = await query(
            `SELECT column_name FROM information_schema.columns
              WHERE table_name = 'Media' AND column_name = 'ContentHash'`,
        );
        expect(res.rows).toHaveLength(1);
    });
});
