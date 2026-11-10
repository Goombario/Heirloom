import { query, getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import { getTreeSharingPermission } from './sharing';
import { AccessError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import { DEFAULT_TREE_NAME } from '@/lib/utils/tree-name';
import type { Tree, NewTree } from '../schema';

/**
 * Multi-tree query layer. A "Trees" row is the scope every entity table hangs
 * off via its "TreeId" column; the legacy owner columns (UserId/OwnerId/
 * TreeOwnerId) keep recording the owning USER.
 * Spec: docs/superpowers/specs/2026-07-03-multi-tree-per-account-feasibility.md
 */


export async function listTreesForUser(userId: number): Promise<Tree[]> {
  // ORDER BY "Id" ASC — index 0 is the user's default tree.
  const result = await query('SELECT * FROM "Trees" WHERE "OwnerId" = $1 ORDER BY "Id" ASC', [userId]);
  return result.rows as Tree[];
}

export async function getTree(treeId: number): Promise<Tree | null> {
  const result = await query('SELECT * FROM "Trees" WHERE "Id" = $1', [treeId]);
  return (result.rows[0] as Tree) ?? null;
}

/** Lock a tree row for transaction-scoped operations that must serialize by tree. */
export async function lockTreeForUpdate(
  treeId: number,
  exec: { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> } = { query },
): Promise<boolean> {
  const result = await exec.query(
    `SELECT "Id" FROM "Trees" WHERE "Id" = $1 FOR UPDATE`,
    [treeId],
  );
  return result.rows.length > 0;
}

export async function createTree(data: NewTree): Promise<Tree> {
  const result = await query(
    'INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, $2) RETURNING *',
    [data.OwnerId, data.Name]
  );
  return result.rows[0] as Tree;
}

/** Caller must have verified ownership (service layer). */
export async function renameTree(treeId: number, name: string): Promise<Tree> {
  const result = await query(
    'UPDATE "Trees" SET "Name" = $1, "UpdatedAt" = CURRENT_TIMESTAMP WHERE "Id" = $2 RETURNING *',
    [name, treeId]
  );
  const tree = result.rows[0] as Tree | undefined;
  if (!tree) throw new Error('Tree not found');
  return tree;
}

export async function countTreesForUser(userId: number): Promise<number> {
  const result = await query('SELECT count(*)::int AS n FROM "Trees" WHERE "OwnerId" = $1', [userId]);
  return (result.rows[0] as { n: number }).n;
}

/** First key of the advisory lock that serializes creating an owner's first tree. */
const DEFAULT_TREE_LOCK = 0x54524545;

// In the browser build a page asks for the default tree once per read, so one
// Library open looked it up dozens of times (#1266), each lookup a dozen PGlite
// worker round trips. Concurrent callers there share one lookup. That is safe only on
// PGlite's single serialized connection: a lookup in flight finishes before any
// later write starts, so no caller can join a lookup older than its own write.
// It is dropped once settled, so a changed default tree is never stale. The
// hosted server (no window) runs every lookup on a pooled connection, unshared.
const sharedDefaultTreeLookups = new Map<number, Promise<number>>();

type DefaultTreeMemo = (userId: number, lookup: () => Promise<number>) => Promise<number>;
let defaultTreeMemo: DefaultTreeMemo | null = null;

/**
 * The local build also remembers each user's default tree until the next write
 * (lib/data/local/default-tree.ts), so it isn't looked up again on every read
 * (#1269). The memo steps aside while a write runs; the shared lookup above
 * still covers that. The server never sets this.
 */
export function setDefaultTreeMemo(memo: DefaultTreeMemo | null): void {
  defaultTreeMemo = memo;
}

/**
 * The user's default tree = lowest Id; lazily created on first need (covers
 * post-migration signups without touching the provisioning path). Concurrent
 * first calls are serialized, so exactly one tree is created (#1007).
 */
export function resolveDefaultTree(userId: number): Promise<number> {
  if (defaultTreeMemo) return defaultTreeMemo(userId, () => sharedDefaultTreeLookup(userId));
  return sharedDefaultTreeLookup(userId);
}

function sharedDefaultTreeLookup(userId: number): Promise<number> {
  if (typeof window === 'undefined') return lookUpDefaultTree(userId);
  let lookup = sharedDefaultTreeLookups.get(userId);
  if (!lookup) {
    lookup = lookUpDefaultTree(userId).finally(() => sharedDefaultTreeLookups.delete(userId));
    sharedDefaultTreeLookups.set(userId, lookup);
  }
  return lookup;
}

async function lookUpDefaultTree(userId: number): Promise<number> {
  const existing = await query(
    'SELECT "Id" FROM "Trees" WHERE "OwnerId" = $1 ORDER BY "Id" ASC LIMIT 1',
    [userId]
  );
  if (existing.rows[0]) return (existing.rows[0] as { Id: number }).Id;
  // First use: the import page's preview, counts and import all arrive at once,
  // and each used to create its own "My tree" (#1007). The owner's advisory lock
  // makes them take turns, so the first creates the tree and the rest find it.
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [DEFAULT_TREE_LOCK, userId]);
    const found = await client.query(
      'SELECT "Id" FROM "Trees" WHERE "OwnerId" = $1 ORDER BY "Id" ASC LIMIT 1',
      [userId]
    );
    const row = (found.rows[0] ?? (await client.query(
      'INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, $2) RETURNING "Id"',
      [userId, DEFAULT_TREE_NAME]
    )).rows[0]) as { Id: number };
    await client.query('COMMIT');
    return row.Id;
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete every row belonging to a tree, then the tree itself, in ONE
 * transaction. Table order mirrors importGedcomService's overwrite wipe
 * (children/links before parents) plus NameVariant, AuditLog, TreeSharing and
 * the Trees row. Junction tables without TreeId are covered by FK cascades
 * (MediaTag/MediaBlob/MediaThumb/MediaLink via Media; NoteLink via Note;
 * CasePerson/CaseMedia/CaseComments via Cases) or the explicit
 * FamilyPerson subquery (no FK on that table).
 *
 * NOT restorable: this is raw SQL that bypasses audit capture, and the tree's
 * own AuditLog rows are removed too — which is why the service/API layer
 * guards it (X-Confirm-Delete-Tree header + type-the-name UI).
 *
 * Returns the dead tree's Media.FilePath values so the SERVICE layer can
 * best-effort unlink files from disk after commit. Only client.query is used
 * inside the transaction (PGlite is single-connection — the global query()
 * here would deadlock).
 *
 * `ownerId` enforces the ≥1-tree invariant TRANSACTIONALLY: the owner's Trees
 * rows are locked (FOR UPDATE) and re-counted inside the transaction, so two
 * concurrent confirmed deletes on a 2-tree account can't both pass the
 * service-layer pre-check and leave the account with 0 trees.
 */
export async function deleteTreeData(treeId: number, ownerId: number): Promise<string[]> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT "Id" FROM "Trees" WHERE "OwnerId" = $1 ORDER BY "Id" FOR UPDATE',
      [ownerId]
    );
    const ownedIds = (locked.rows as { Id: number }[]).map((r) => r.Id);
    if (!ownedIds.includes(treeId)) {
      // Deleted (or re-checked after a concurrent delete) between the service
      // pre-check and here.
      throw new AccessError('Access denied: You do not own this tree');
    }
    if (ownedIds.length <= 1) {
      throw new ValidationError('Cannot delete your last tree');
    }
    const media = await client.query(
      'SELECT "FilePath" FROM "Media" WHERE "TreeId" = $1 AND "FilePath" IS NOT NULL',
      [treeId]
    );
    await client.query('DELETE FROM "Citation" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "DataCheckConfirmations" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "Note" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "Sources" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "Repository" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "Events" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "Media" WHERE "TreeId" = $1', [treeId]);
    await client.query(
      'DELETE FROM "FamilyPerson" WHERE "FamiliesAsChildId" IN (SELECT "Id" FROM "Families" WHERE "TreeId" = $1)',
      [treeId]
    );
    await client.query('DELETE FROM "Families" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "NameVariant" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "People" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "Cases" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "Places" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "AuditLog" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "TreeSharing" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "PendingShares" WHERE "TreeId" = $1', [treeId]);
    await client.query('DELETE FROM "Trees" WHERE "Id" = $1', [treeId]);
    await client.query('COMMIT');
    return (media.rows as { FilePath: string }[]).map((m) => m.FilePath);
  } catch (e) {
    await safeRollback(client);
    throw e;
  } finally {
    client.release();
  }
}

export interface RequestedScope {
  /** Explicit ?treeId= — the primary scope parameter. */
  treeId?: number | null;
  /** Legacy ?ownerId= (deep-link/back-compat): that user's default tree. */
  ownerId?: number | null;
}

export interface TreeScope {
  treeId: number;
  /** The tree's owning user — written to the legacy owner columns on INSERT. */
  ownerId: number;
  permission: 'owner' | 'edit' | 'contribute' | 'view';
}

const DENIED = 'Access denied: You do not have permission to view this tree';

/**
 * THE scope choke point. Replaces the old two-liner at every service site:
 *   await validateTreeAccess(requestedOwnerId, currentUserId);
 *   const effectiveOwnerId = requestedOwnerId ?? currentUserId;
 * Precedence: explicit treeId → legacy ownerId (that user's default tree,
 * kept so pre-multi-tree links and tests keep working) → the caller's own
 * default tree.
 * Share permission is per-tree: getTreeSharingPermission(tree.Id, ...). The
 * legacy ownerId branch resolves that owner's default tree first, then runs
 * the same tree-keyed check on it.
 */
export async function resolveTreeScope(
  requested: RequestedScope,
  currentUserId: number
): Promise<TreeScope> {
  const requestedTreeId = requested.treeId ?? null;
  const legacyOwnerId = requested.ownerId ?? null;

  if (requestedTreeId !== null) {
    const tree = await getTree(requestedTreeId);
    // Deliberately AccessError (not NotFound) for a nonexistent id, so tree
    // ids can't be probed to distinguish "doesn't exist" from "not yours".
    if (!tree) throw new AccessError(DENIED);
    if (tree.OwnerId === currentUserId) {
      return { treeId: tree.Id, ownerId: tree.OwnerId, permission: 'owner' };
    }
    const permission = await getTreeSharingPermission(tree.Id, currentUserId);
    if (!permission) throw new AccessError(DENIED);
    return { treeId: tree.Id, ownerId: tree.OwnerId, permission };
  }

  if (legacyOwnerId !== null && legacyOwnerId !== currentUserId) {
    // SELECT-only default-tree lookup: never CREATE a Trees row for another
    // user as a side effect of an access probe, and let a nonexistent user id
    // resolve to the same AccessError as an unshared one (resolveDefaultTree's
    // INSERT raised a 500 FK violation there — a user-id enumeration oracle).
    // No tree ⇒ no share can reference it ⇒ denied.
    const existing = await query(
      'SELECT "Id" FROM "Trees" WHERE "OwnerId" = $1 ORDER BY "Id" ASC LIMIT 1',
      [legacyOwnerId]
    );
    const treeId = (existing.rows[0] as { Id: number } | undefined)?.Id;
    if (!treeId) throw new AccessError(DENIED);
    const permission = await getTreeSharingPermission(treeId, currentUserId);
    if (!permission) throw new AccessError(DENIED);
    return { treeId, ownerId: legacyOwnerId, permission };
  }

  return {
    treeId: await resolveDefaultTree(currentUserId),
    ownerId: currentUserId,
    permission: 'owner',
  };
}
