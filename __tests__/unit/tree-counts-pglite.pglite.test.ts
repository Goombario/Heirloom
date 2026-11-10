import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import { truncateAllTables } from '../setup/pglite-truncate';

/**
 * `getTreeCountsService` on PGlite.
 *
 * Exercised against real PostgreSQL in `__tests__/integration/tree-counts.test.ts`,
 * but the local/offline build (Cloudflare + Tauri) runs this exact service
 * in-browser via `LocalTreeClient.getCounts` — and it gates a destructive
 * import there too. So it must return the same numbers on both engines.
 */

const holder = vi.hoisted(() => ({ db: null as PGlite | null }));

vi.mock('@/lib/db/connection', () => ({
    query: (text: string, params?: unknown[]) => holder.db!.query(text, params as never[]),
    getClient: () => { throw new Error('not used by getTreeCountsService'); },
    closePool: async () => {},
}));

// resolveTreeScope consults getTreeSharingPermission only for foreign trees;
// own-tree access is the only path the local build takes, so no share exists.
vi.mock('@/lib/db/queries/sharing', () => ({
    getTreeSharingPermission: async () => null,
}));

import { getTreeCountsService } from '@/lib/services/tree-counts';

const USER = 1;
const OTHER = 2;

let db: PGlite;

beforeAll(async () => {
    db = await newEmptyClusterDb();
    holder.db = db;
    await initializeSchema(db as unknown as DbExecutor);
});

afterEach(async () => {
    await truncateAllTables(db);
});

async function seedUsers() {
    await db.query(
        `INSERT INTO "Users" ("Id","Email","GoogleId")
         VALUES (${USER},'a@test.local','google-a'), (${OTHER},'b@test.local','google-b')`
    );
    // Multi-tree: counts are TreeId-scoped now. Tree ids mirror user ids so the
    // seeds below can stamp TreeId = owner id; resolveDefaultTree picks these
    // (lowest Id per owner) as each user's default tree.
    await db.query(
        `INSERT INTO "Trees" ("Id","OwnerId","Name")
         VALUES (${USER},${USER},'My Tree'), (${OTHER},${OTHER},'My Tree')`
    );
}

describe('getTreeCountsService (PGlite)', () => {
    it('returns all-zero for an empty tree — the state that skips the confirm', async () => {
        await seedUsers();
        const counts = await getTreeCountsService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: USER });
        expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    });

    it('counts a tree holding only standalone repositories', async () => {
        // The exact shape that was silently wiped before the counts service existed.
        await seedUsers();
        await db.query(`INSERT INTO "Repository" ("OwnerId","TreeId","Name") VALUES (${USER},${USER},'County Archive')`);

        const counts = await getTreeCountsService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: USER });
        expect(counts.repositories).toBe(1);
        expect(counts.people).toBe(0);
        expect(Object.values(counts).every((n) => n === 0)).toBe(false);
    });

    it('counts a tree holding only a geocoded places gazetteer', async () => {
        await seedUsers();
        await db.query(`INSERT INTO "Places" ("UserId","TreeId","Name","Latitude","Longitude") VALUES (${USER},${USER},'Dover',51.1,1.2)`);

        const counts = await getTreeCountsService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: USER });
        expect(counts.places).toBe(1);
        expect(Object.values(counts).every((n) => n === 0)).toBe(false);
    });

    it('counts people, families and events for a populated tree', async () => {
        await seedUsers();
        await db.query(`INSERT INTO "People" ("Id","UserId","TreeId","FirstName") VALUES (1,${USER},${USER},'Ada'), (2,${USER},${USER},'Charles')`);
        await db.query(`INSERT INTO "Families" ("Id","UserId","TreeId") VALUES (1,${USER},${USER})`);
        await db.query(`INSERT INTO "Events" ("UserId","TreeId","PersonId","Type") VALUES (${USER},${USER},1,'BIRT')`);

        const counts = await getTreeCountsService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: USER });
        expect(counts).toMatchObject({ people: 2, families: 1, events: 1 });
    });

    it('scopes every count to the tree owner — another user\'s rows never leak in', async () => {
        await seedUsers();
        await db.query(`INSERT INTO "People" ("Id","UserId","TreeId","FirstName") VALUES (1,${OTHER},${OTHER},'Nobody')`);
        await db.query(`INSERT INTO "Repository" ("OwnerId","TreeId","Name") VALUES (${OTHER},${OTHER},'Their Archive')`);

        const counts = await getTreeCountsService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: USER });
        expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    });
});
