import { query } from '@/lib/db/connection';
import type { TreeSharing, NewTreeSharing, PendingShare } from '../schema';

/**
 * Per-tree sharing (multi-tree Phase 5). Shares are keyed on
 * ("TreeId", "SharedWithId") — the old account-level (OwnerId, SharedWithId)
 * key is gone (unique index idx_sharing_tree_shared). "OwnerId" is still
 * written on every row: it records the tree's owning USER for display and
 * back-compat (legacy ?ownerId= deep links, cleanup scoping).
 */

/** A share the current user has granted, with the shared tree's name. */
export interface SharedWithRow extends TreeSharing {
  TreeName: string | null;
}

/** A tree shared WITH the current user, with tree name + owner identity. */
export interface SharedWithMeRow extends TreeSharing {
  TreeName: string | null;
  owner: { Id: number; Email: string; Name: string | null } | null;
}

/**
 * Get all shares the current user has granted (one row per tree × person).
 */
export async function getSharedWith(userId: number): Promise<SharedWithRow[]> {
  const result = await query(
    `SELECT ts.*, t."Name" AS "TreeName"
     FROM "TreeSharing" ts
     LEFT JOIN "Trees" t ON t."Id" = ts."TreeId"
     WHERE ts."OwnerId" = $1
     ORDER BY ts."TreeId" ASC, ts."Id" ASC`,
    [userId]
  );
  return result.rows as SharedWithRow[];
}

/**
 * Get all trees shared with the current user — one row per shared TREE,
 * carrying the tree name and the owning user's identity.
 */
export async function getSharedWithMe(userId: number): Promise<SharedWithMeRow[]> {
  const result = await query(
    `SELECT ts.*, t."Name" AS "TreeName",
            u."Id" AS "OwnerUserId", u."Email" AS "OwnerEmail", u."Name" AS "OwnerName"
     FROM "TreeSharing" ts
     LEFT JOIN "Trees" t ON t."Id" = ts."TreeId"
     LEFT JOIN "Users" u ON u."Id" = ts."OwnerId"
     WHERE ts."SharedWithId" = $1
     ORDER BY ts."TreeId" ASC, ts."Id" ASC`,
    [userId]
  );
  return (result.rows as Array<TreeSharing & {
    TreeName: string | null;
    OwnerUserId: number | null;
    OwnerEmail: string | null;
    OwnerName: string | null;
  }>).map(({ OwnerUserId, OwnerEmail, OwnerName, ...share }) => ({
    ...share,
    owner: OwnerUserId !== null
      ? { Id: OwnerUserId, Email: OwnerEmail ?? '', Name: OwnerName }
      : null,
  }));
}

/**
 * Get the sharing permission a user holds on a specific TREE.
 * Returns null if the tree is not shared with them.
 */
export async function getTreeSharingPermission(treeId: number, userId: number): Promise<'view' | 'contribute' | 'edit' | null> {
  const result = await query(
    'SELECT "Permission" FROM "TreeSharing" WHERE "TreeId" = $1 AND "SharedWithId" = $2',
    [treeId, userId]
  );
  return (result.rows[0]?.Permission as 'view' | 'contribute' | 'edit') || null;
}

/**
 * Check if a user may write to a record in the given tree.
 * Defense-in-depth check in the query layer (the primary authorization is the
 * tree-scoped SELECT each mutator does first + resolveTreeScope at the
 * service layer). Keyed on the TREE, not the owner: with per-tree shares an
 * owner-keyed lookup would pick an arbitrary share (e.g. 'view' on tree A)
 * and falsely deny writes on a tree shared as 'edit'.
 */
export async function hasEditPermission(recordOwnerId: number, currentUserId: number, treeId: number): Promise<boolean> {
  // Owner always has edit permission
  if (recordOwnerId === currentUserId) {
    return true;
  }

  const permission = await getTreeSharingPermission(treeId, currentUserId);
  return permission === 'edit' || permission === 'contribute';
}

/**
 * Create a new share (give someone access to one of your trees).
 * Caller (route/service) must have verified data.OwnerId owns data.TreeId.
 * Race-safe: the unique index (idx_sharing_tree_shared) resolves two
 * concurrent identical shares deterministically — the loser gets the same
 * "already shared" error the pre-check produces, not a raw 23505 → 500.
 */
export async function createShare(data: NewTreeSharing): Promise<TreeSharing> {
  const result = await query(
    `INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "TreeId", "Permission")
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ("TreeId", "SharedWithId") DO NOTHING
     RETURNING *`,
    [data.OwnerId, data.SharedWithId, data.TreeId, data.Permission]
  );

  const newShare = result.rows[0] as TreeSharing | undefined;
  if (!newShare) {
    throw new Error('Tree is already shared with this user');
  }

  return newShare;
}

/** Fetch one share row by its Id (for ownership checks before update/revoke). */
export async function getShareById(shareId: number): Promise<TreeSharing | null> {
  const result = await query('SELECT * FROM "TreeSharing" WHERE "Id" = $1', [shareId]);
  return (result.rows[0] as TreeSharing | undefined) ?? null;
}

/**
 * Update a share row's permission. Keyed by the row's Id (the caller has
 * already ownership-checked it) — the old (TreeId, SharedWithId) key could
 * never match a legacy NULL-TreeId row.
 */
export async function updateSharePermission(shareId: number, permission: 'view' | 'contribute' | 'edit'): Promise<TreeSharing> {
  const result = await query(
    `UPDATE "TreeSharing" SET "Permission" = $1 WHERE "Id" = $2 RETURNING *`,
    [permission, shareId]
  );

  const updated = result.rows[0] as TreeSharing;
  if (!updated) {
    throw new Error('Failed to update share permission');
  }

  return updated;
}

/**
 * Delete a share (revoke a user's access to a tree). Keyed by the row's Id —
 * see updateSharePermission.
 */
export async function deleteShare(shareId: number): Promise<boolean> {
  const result = await query(
    'DELETE FROM "TreeSharing" WHERE "Id" = $1',
    [shareId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** A pending share the current user has granted, with the shared tree's name (#1228). */
export interface PendingShareRow extends PendingShare {
  TreeName: string | null;
}

/** Pending shares the current user has granted: addresses with no account yet. */
export async function getPendingSharesByOwner(userId: number): Promise<PendingShareRow[]> {
  const result = await query(
    `SELECT ps.*, t."Name" AS "TreeName"
     FROM "PendingShares" ps
     LEFT JOIN "Trees" t ON t."Id" = ps."TreeId"
     WHERE ps."OwnerId" = $1
     ORDER BY ps."TreeId" ASC, ps."Id" ASC`,
    [userId]
  );
  return result.rows as PendingShareRow[];
}

/**
 * Store a share for an address with no account. "Email" must already be
 * normalised. Race-safe on idx_pendingshares_tree_email like createShare.
 */
export async function createPendingShare(data: Omit<PendingShare, 'Id' | 'CreatedAt'>): Promise<PendingShare> {
  const result = await query(
    `INSERT INTO "PendingShares" ("OwnerId", "TreeId", "Email", "Permission")
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ("TreeId", "Email") DO NOTHING
     RETURNING *`,
    [data.OwnerId, data.TreeId, data.Email, data.Permission]
  );

  const pending = result.rows[0] as PendingShare | undefined;
  if (!pending) {
    throw new Error('Tree is already shared with this address');
  }
  return pending;
}

export async function getPendingShareById(id: number): Promise<PendingShare | null> {
  const result = await query('SELECT * FROM "PendingShares" WHERE "Id" = $1', [id]);
  return (result.rows[0] as PendingShare | undefined) ?? null;
}

export async function updatePendingSharePermission(id: number, permission: 'view' | 'contribute' | 'edit'): Promise<PendingShare | null> {
  const result = await query(
    `UPDATE "PendingShares" SET "Permission" = $1 WHERE "Id" = $2 RETURNING *`,
    [permission, id]
  );
  return (result.rows[0] as PendingShare | undefined) ?? null;
}

export async function deletePendingShare(id: number): Promise<boolean> {
  const result = await query('DELETE FROM "PendingShares" WHERE "Id" = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Turn every pending share for this address into a real share for this user, in
 * one statement: the DELETE locks each row, so two sign-ins (or a sign-in and the
 * owner's re-check) can't both move it. A tree already shared with the user keeps
 * its existing share; the user's own trees are skipped. Returns how many moved.
 */
export async function applyPendingShares(userId: number, email: string): Promise<number> {
  const result = await query(
    `WITH moved AS (
       DELETE FROM "PendingShares" WHERE "Email" = $1
       RETURNING "OwnerId", "TreeId", "Permission"
     )
     INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "TreeId", "Permission")
     SELECT "OwnerId", $2, "TreeId", "Permission" FROM moved WHERE "OwnerId" <> $2
     ON CONFLICT ("TreeId", "SharedWithId") DO NOTHING`,
    [email, userId]
  );
  return result.rowCount ?? 0;
}

/** The share of this tree with this user, if any. */
export async function getTreeShare(treeId: number, userId: number): Promise<TreeSharing | null> {
  const result = await query(
    'SELECT * FROM "TreeSharing" WHERE "TreeId" = $1 AND "SharedWithId" = $2',
    [treeId, userId]
  );
  return (result.rows[0] as TreeSharing | undefined) ?? null;
}
