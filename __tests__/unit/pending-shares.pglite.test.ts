import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { createTree, resolveDefaultTree, resolveTreeScope, deleteTreeData } from '@/lib/db/queries/trees';
import {
    createShareService, listPendingSharesService, updatePendingShareService, deletePendingShareService,
    applyPendingSharesForUser,
} from '@/lib/services/sharing';
import { resolveOrCreateUser } from '@/lib/auth/provision';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * Pending shares (#1228): sharing a tree with an address that has no account
 * stores the share by address, and that person's first sign-in turns it into a
 * real share. The HTTP routes are covered in `__tests__/integration/api/sharing.test.ts`.
 */
const OWNER = 1_228_001;
const OTHER = 1_228_002;

describe('pending shares', () => {
    let db: PGlite;
    let treeId: number;
    const share = (email: string, permission = 'view', currentUserId = OWNER) =>
        createShareService({ email, permission, treeId, currentUserId });
    const pendingRows = async () =>
        (await query('SELECT "TreeId", "Email", "Permission" FROM "PendingShares" ORDER BY "Id"')).rows;

    beforeAll(async () => {
        db = await newEmptyClusterDb();
        __setTestDb(db);
        await query('SELECT 1');
    });

    beforeEach(async () => {
        await query('DELETE FROM "TreeSharing"');
        await query('DELETE FROM "PendingShares"');
        await query('DELETE FROM "Trees"');
        await query('DELETE FROM "Users"');
        for (const [id, email] of [[OWNER, 'owner@test.local'], [OTHER, 'Other@Test.local']] as const) {
            await query('INSERT INTO "Users" ("Id", "Email", "GoogleId", "Name") VALUES ($1, $2, $3, $4)', [id, email, `g-${id}`, String(id)]);
        }
        treeId = await resolveDefaultTree(OWNER);
    });

    afterAll(async () => {
        __setTestDb(null);
        await db.close();
    });

    it('stores an address with no account as a pending share, normalised', async () => {
        const result = await share('  Newcomer@Example.com ', 'contribute');
        expect(result.share).toBeUndefined();
        expect(result.pending).toMatchObject({ TreeId: treeId, Email: 'newcomer@example.com', Permission: 'contribute' });
        expect(await pendingRows()).toHaveLength(1);
        const listed = await listPendingSharesService({ currentUserId: OWNER });
        expect(listed).toEqual([expect.objectContaining({ Email: 'newcomer@example.com', TreeName: expect.any(String) })]);
        expect(await listPendingSharesService({ currentUserId: OTHER })).toEqual([]);
    });

    it('shares directly with an existing user whatever case the address is typed in', async () => {
        const result = await share('OTHER@test.LOCAL', 'edit');
        expect(result.share).toMatchObject({ SharedWithId: OTHER, TreeId: treeId, Permission: 'edit' });
        expect(await pendingRows()).toEqual([]);
    });

    it('refuses the owner\'s own address in any case, a bad address and a second pending share', async () => {
        await expect(share('OWNER@test.local')).rejects.toThrow(ValidationError);
        await expect(share('not-an-address')).rejects.toThrow(ValidationError);
        await share('newcomer@example.com');
        await expect(share('NEWCOMER@example.com')).rejects.toThrow(/already shared/);
    });

    it('refuses to guess between two accounts whose addresses differ only in case', async () => {
        await query('INSERT INTO "Users" ("Email", "GoogleId", "Name") VALUES ($1, $2, $3)', ['other@test.local', 'g-dup', 'Dup']);
        await expect(share('other@test.local')).rejects.toThrow(ValidationError);
        expect(await pendingRows()).toEqual([]);
    });

    it('lets only the tree owner share it, by pending share too', async () => {
        await expect(createShareService({ email: 'newcomer@example.com', permission: 'view', treeId, currentUserId: OTHER }))
            .rejects.toThrow(AccessError);
        expect(await pendingRows()).toEqual([]);
    });

    it('applies at first sign-in: the newcomer gets the tree at the stored permission', async () => {
        await share('newcomer@example.com', 'contribute');
        const user = await resolveOrCreateUser({ googleId: 'g-new', email: 'Newcomer@example.com', name: 'New', image: null, emailVerified: true });
        expect(await applyPendingSharesForUser(user.id, 'Newcomer@example.com')).toBe(1);
        expect(await pendingRows()).toEqual([]);
        const scope = await resolveTreeScope({ treeId }, user.id);
        expect(scope.permission).toBe('contribute');
        // A second sign-in has nothing left to apply.
        expect(await applyPendingSharesForUser(user.id, 'newcomer@example.com')).toBe(0);
    });

    it('applies only the matching address and keeps an existing share as it is', async () => {
        await share('newcomer@example.com', 'edit');
        await share('someone-else@example.com');
        const user = await resolveOrCreateUser({ googleId: 'g-new', email: 'newcomer@example.com', name: 'New', image: null, emailVerified: true });
        await query(`INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "TreeId", "Permission") VALUES ($1, $2, $3, 'view')`, [OWNER, user.id, treeId]);
        await applyPendingSharesForUser(user.id, 'newcomer@example.com');
        expect(await pendingRows()).toEqual([expect.objectContaining({ Email: 'someone-else@example.com' })]);
        expect((await resolveTreeScope({ treeId }, user.id)).permission).toBe('view');
    });

    it('lets the owner change or remove a pending share, and nobody else', async () => {
        const { pending } = await share('newcomer@example.com');
        const id = pending!.Id;
        await expect(updatePendingShareService({ pendingId: id, permission: 'edit', currentUserId: OTHER })).rejects.toThrow(AccessError);
        await expect(updatePendingShareService({ pendingId: id, permission: 'owner', currentUserId: OWNER })).rejects.toThrow(ValidationError);
        expect(await updatePendingShareService({ pendingId: id, permission: 'edit', currentUserId: OWNER }))
            .toMatchObject({ Permission: 'edit' });
        await expect(deletePendingShareService({ pendingId: id, currentUserId: OTHER })).rejects.toThrow(AccessError);
        await deletePendingShareService({ pendingId: id, currentUserId: OWNER });
        await expect(deletePendingShareService({ pendingId: id, currentUserId: OWNER })).rejects.toThrow(NotFoundError);
        expect(await pendingRows()).toEqual([]);
    });

    it('goes with the tree when the tree is deleted', async () => {
        await createTree({ OwnerId: OWNER, Name: 'Second' }); // the last tree can't be deleted
        await share('newcomer@example.com');
        await deleteTreeData(treeId, OWNER);
        expect(await pendingRows()).toEqual([]);
    });
});
