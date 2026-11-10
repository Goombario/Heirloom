import {
    getSharedWith,
    getShareById,
    createShare,
    updateSharePermission,
    deleteShare,
    getTreeShare,
    getPendingSharesByOwner,
    createPendingShare,
    getPendingShareById,
    updatePendingSharePermission,
    deletePendingShare,
    applyPendingShares,
    type SharedWithRow,
    type PendingShareRow,
} from '@/lib/db/queries/sharing';
import { getTree, resolveDefaultTree } from '@/lib/db/queries/trees';
import { getUserSummaryById, getUserSummariesByNormalizedEmail, type UserSummary } from '@/lib/db/queries/users';
import type { PendingShare, TreeSharing } from '@/lib/db/schema';
import { normalizeEmail } from '@/lib/auth/allowed-emails';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';

const PERMISSIONS = ['view', 'contribute', 'edit'] as const;
type SharePermission = (typeof PERMISSIONS)[number];
/** Loose on purpose, as on the Members page: this only catches typos. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 320;

export interface EnrichedShare extends SharedWithRow {
    sharedWithUser: UserSummary | null;
}

/** GET /api/sharing — shares the current user has granted, with recipient identity. */
export async function listSharesService(params: { currentUserId: number }): Promise<EnrichedShare[]> {
    const shares = await getSharedWith(params.currentUserId);
    return Promise.all(shares.map(async (share) => {
        try {
            return { ...share, sharedWithUser: await getUserSummaryById(share.SharedWithId) };
        } catch {
            return { ...share, sharedWithUser: null };
        }
    }));
}

/**
 * The account an address belongs to, ignoring case. Two accounts that differ only
 * in case (possible on legacy rows) are refused rather than guessed between.
 */
async function accountFor(email: string): Promise<UserSummary | null> {
    const matches = await getUserSummariesByNormalizedEmail(email);
    if (matches.length > 1) {
        throw new ValidationError('More than one account uses this address, so it can’t be shared with automatically');
    }
    return matches[0] ?? null;
}

export interface CreateShareParams {
    email: unknown;
    permission: unknown;
    treeId: unknown;
    currentUserId: number;
}

/** POST /api/sharing: a share for an existing user, or a pending share by address (#1228). */
export type CreateShareResult =
    | { share: TreeSharing; pending?: never }
    | { pending: PendingShare; share?: never };

/**
 * POST /api/sharing. Throws ValidationError (400), AccessError (403); the
 * "already shared" errors pass through for the route to map to 409.
 *
 * An address with no account yet gets a pending share, which that person's first
 * sign-in turns into a real one (applyPendingSharesForUser).
 */
export async function createShareService(params: CreateShareParams): Promise<CreateShareResult> {
    const { email: rawEmail, permission, treeId: requestedTreeId, currentUserId } = params;

    if (!rawEmail || typeof rawEmail !== 'string') {
        throw new ValidationError('Email is required');
    }
    const email = normalizeEmail(rawEmail);
    if (!email) throw new ValidationError('Email is required');
    if (email.length > MAX_EMAIL || !EMAIL_SHAPE.test(email)) {
        throw new ValidationError('Enter a valid email address');
    }
    if (!permission || !PERMISSIONS.includes(permission as SharePermission)) {
        throw new ValidationError('Permission must be "view", "contribute", or "edit"');
    }

    // Per-tree sharing: an explicit treeId picks the tree; omitted/null
    // defaults to the caller's default tree (back-compat for older callers).
    if (requestedTreeId != null && (typeof requestedTreeId !== 'number' || !Number.isInteger(requestedTreeId) || requestedTreeId <= 0)) {
        throw new ValidationError('Invalid treeId');
    }

    let treeId: number;
    if (requestedTreeId != null) {
        const tree = await getTree(requestedTreeId as number);
        // Only the tree's OWNER may share it. Same response for
        // nonexistent and not-owned so tree ids can't be probed.
        if (!tree || tree.OwnerId !== currentUserId) {
            throw new AccessError('You can only share your own trees');
        }
        treeId = tree.Id;
    } else {
        treeId = await resolveDefaultTree(currentUserId);
    }

    // An existing "Users" row is trusted as the address's owner, as before #1228:
    // it was created by a sign-in the membership rules admitted.
    const targetUser = await accountFor(email);
    if (targetUser) {
        if (targetUser.Id === currentUserId) {
            throw new ValidationError('Cannot share tree with yourself');
        }
        return {
            share: await createShare({
                OwnerId: currentUserId,
                SharedWithId: targetUser.Id,
                TreeId: treeId,
                Permission: permission as SharePermission,
            }),
        };
    }

    const pending = await createPendingShare({
        OwnerId: currentUserId,
        TreeId: treeId,
        Email: email,
        Permission: permission as SharePermission,
    });
    // The person may have signed in for the first time between the lookup above
    // and the insert, after their sign-in had already applied pending shares.
    // Look again; applyPendingShares moves each row once, whoever runs it first.
    const latecomer = await accountFor(email).catch(() => null);
    if (latecomer && (await applyPendingSharesForUser(latecomer.Id, email)) !== null) {
        const share = await getTreeShare(treeId, latecomer.Id);
        if (share) return { share };
    }
    return { pending };
}

/** GET /api/sharing: the current user's pending shares, alongside the real ones. */
export async function listPendingSharesService(params: { currentUserId: number }): Promise<PendingShareRow[]> {
    return getPendingSharesByOwner(params.currentUserId);
}

/** PUT /api/sharing/pending/[id]. Throws ValidationError/NotFoundError/AccessError. */
export async function updatePendingShareService(params: {
    pendingId: number;
    permission: unknown;
    currentUserId: number;
}): Promise<PendingShare> {
    const { pendingId, permission, currentUserId } = params;

    if (!permission || !PERMISSIONS.includes(permission as SharePermission)) {
        throw new ValidationError('Invalid permission');
    }

    const pending = await getPendingShareById(pendingId);
    if (!pending) throw new NotFoundError('Share not found');
    if (pending.OwnerId !== currentUserId) {
        throw new AccessError('You can only modify your own shares');
    }

    // Gone in between means the person signed in and it became a real share.
    const updated = await updatePendingSharePermission(pending.Id, permission as SharePermission);
    if (!updated) throw new NotFoundError('Share not found');
    return updated;
}

/** DELETE /api/sharing/pending/[id]. Throws NotFoundError/AccessError. */
export async function deletePendingShareService(params: {
    pendingId: number;
    currentUserId: number;
}): Promise<void> {
    const { pendingId, currentUserId } = params;

    const pending = await getPendingShareById(pendingId);
    if (!pending) throw new NotFoundError('Share not found');
    if (pending.OwnerId !== currentUserId) {
        throw new AccessError('You can only revoke your own shares');
    }

    if (!(await deletePendingShare(pending.Id))) throw new NotFoundError('Share not found');
}

/**
 * Turn the pending shares for this person's address into real shares. Returns how
 * many were applied, or null when it failed. Never throws: a failure here must not
 * block sign-in, and the rows stay pending for a retry.
 */
export async function applyPendingSharesForUser(userId: number, email: string): Promise<number | null> {
    try {
        return await applyPendingShares(userId, normalizeEmail(email));
    } catch (err) {
        console.error('[Sharing] Could not apply pending shares:', err);
        return null;
    }
}

/** PUT /api/sharing/[id]. Throws ValidationError/NotFoundError/AccessError. */
export async function updateSharePermissionService(params: {
    shareId: number;
    permission: unknown;
    currentUserId: number;
}): Promise<TreeSharing> {
    const { shareId, permission, currentUserId } = params;

    if (!permission || !PERMISSIONS.includes(permission as SharePermission)) {
        throw new ValidationError('Invalid permission');
    }

    const share = await getShareById(shareId);
    if (!share) throw new NotFoundError('Share not found');
    if (share.OwnerId !== currentUserId) {
        throw new AccessError('You can only modify your own shares');
    }

    return updateSharePermission(share.Id, permission as SharePermission);
}

/** DELETE /api/sharing/[id] (revoke). Throws NotFoundError/AccessError. */
export async function deleteShareService(params: {
    shareId: number;
    currentUserId: number;
}): Promise<void> {
    const { shareId, currentUserId } = params;

    const share = await getShareById(shareId);
    if (!share) throw new NotFoundError('Share not found');
    if (share.OwnerId !== currentUserId) {
        throw new AccessError('You can only revoke your own shares');
    }

    const success = await deleteShare(share.Id);
    if (!success) throw new Error('Failed to delete share');
}
