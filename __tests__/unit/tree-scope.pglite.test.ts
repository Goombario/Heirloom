import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import { truncateAllTables } from '../setup/pglite-truncate';

/**
 * resolveTreeScope — the scope choke point that replaces the old
 * validateTreeAccess + `?? currentUserId` pair at every service site.
 * Precedence: explicit treeId → legacy ownerId (that user's default tree,
 * deep-link compat) → the caller's own default tree.
 */

const holder = vi.hoisted(() => ({ db: null as PGlite | null }));

vi.mock('@/lib/db/connection', () => ({
    query: (text: string, params?: unknown[]) => holder.db!.query(text, params as never[]),
    getClient: async () => ({
        query: (text: string, params?: unknown[]) => holder.db!.query(text, params as never[]),
        release: () => {},
    }),
    closePool: async () => {},
}));

import { resolveTreeScope, resolveDefaultTree, createTree } from '@/lib/db/queries/trees';
import { AccessError } from '@/lib/data/errors';

let db: PGlite;

beforeAll(async () => {
    db = await newEmptyClusterDb();
    holder.db = db;
    await initializeSchema(db as unknown as DbExecutor);
});

afterEach(async () => {
    await truncateAllTables(db);
});

async function makeUser(id: number): Promise<number> {
    await db.query(
        `INSERT INTO "Users" ("Id","Email","GoogleId") VALUES (${id},'u${id}@test.local','g-${id}')`
    );
    return id;
}

async function share(ownerId: number, sharedWithId: number, permission: string, treeId: number): Promise<void> {
    await db.query(
        `INSERT INTO "TreeSharing" ("OwnerId","SharedWithId","Permission","TreeId")
         VALUES (${ownerId},${sharedWithId},'${permission}',${treeId})`
    );
}

describe('resolveTreeScope', () => {
    it('no params → own default tree as owner', async () => {
        const uid = await makeUser(1);
        const scope = await resolveTreeScope({}, uid);
        expect(scope).toEqual({ treeId: await resolveDefaultTree(uid), ownerId: uid, permission: 'owner' });
    });

    it('own treeId → that tree as owner (non-default too)', async () => {
        const uid = await makeUser(1);
        await resolveDefaultTree(uid);
        const second = await createTree({ OwnerId: uid, Name: 'Research' });
        const scope = await resolveTreeScope({ treeId: second.Id }, uid);
        expect(scope).toEqual({ treeId: second.Id, ownerId: uid, permission: 'owner' });
    });

    it("someone else's treeId with a share → shared permission", async () => {
        const owner = await makeUser(1);
        const guest = await makeUser(2);
        const treeId = await resolveDefaultTree(owner);
        await share(owner, guest, 'edit', treeId);
        const scope = await resolveTreeScope({ treeId }, guest);
        expect(scope).toEqual({ treeId, ownerId: owner, permission: 'edit' });
    });

    it("someone else's treeId with no share → AccessError", async () => {
        const owner = await makeUser(1);
        const guest = await makeUser(2);
        const treeId = await resolveDefaultTree(owner);
        await expect(resolveTreeScope({ treeId }, guest)).rejects.toBeInstanceOf(AccessError);
    });

    it('nonexistent treeId → AccessError (no existence leak)', async () => {
        const uid = await makeUser(1);
        await expect(resolveTreeScope({ treeId: 999999 }, uid)).rejects.toBeInstanceOf(AccessError);
    });

    it("legacy ownerId of a sharing user → that user's default tree", async () => {
        const owner = await makeUser(1);
        const guest = await makeUser(2);
        const dt = await resolveDefaultTree(owner);
        await share(owner, guest, 'view', dt);
        const scope = await resolveTreeScope({ ownerId: owner }, guest);
        expect(scope).toEqual({ treeId: dt, ownerId: owner, permission: 'view' });
    });

    it('legacy ownerId with no share → AccessError', async () => {
        const owner = await makeUser(1);
        const guest = await makeUser(2);
        await resolveDefaultTree(owner);
        await expect(resolveTreeScope({ ownerId: owner }, guest)).rejects.toBeInstanceOf(AccessError);
    });

    it('legacy ownerId equal to the caller → own default tree as owner', async () => {
        const uid = await makeUser(1);
        const scope = await resolveTreeScope({ ownerId: uid }, uid);
        expect(scope).toEqual({ treeId: await resolveDefaultTree(uid), ownerId: uid, permission: 'owner' });
    });

    it('treeId wins when both treeId and ownerId are given', async () => {
        const uid = await makeUser(1);
        const other = await makeUser(2);
        await resolveDefaultTree(other);
        const second = await createTree({ OwnerId: uid, Name: 'Mine' });
        const scope = await resolveTreeScope({ treeId: second.Id, ownerId: other }, uid);
        expect(scope.treeId).toBe(second.Id);
        expect(scope.permission).toBe('owner');
    });
});
