import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

/**
 * Multi-tree Phase 0 gate (G-MIG): the "Trees" table exists, every
 * owner-bearing table gains a nullable indexed "TreeId", and the backfill
 * creates exactly one default tree per user and stamps their legacy rows —
 * idempotently across repeated initializeSchema runs.
 * Spec: docs/superpowers/specs/2026-07-03-multi-tree-per-account-feasibility.md
 */

const TREE_SCOPED_TABLES = [
  'People', 'Families', 'Events', 'Media', 'Places', 'Cases',
  'Sources', 'Citation', 'NameVariant', 'Repository', 'Note',
  'AuditLog', 'TreeSharing',
] as const;

async function boot(): Promise<{ db: PGlite; executor: DbExecutor }> {
  const db = await newEmptyClusterDb();
  const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
  await initializeSchema(executor);
  return { db, executor };
}

describe('multi-tree schema (Phase 0)', () => {
  it('creates the Trees table with owner/name columns', async () => {
    const { db } = await boot();
    const r = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Trees'`
    );
    const cols = r.rows.map((c) => c.column_name);
    expect(cols).toEqual(
      expect.arrayContaining(['Id', 'OwnerId', 'Name', 'CreatedAt', 'UpdatedAt'])
    );
    await db.close();
  });

  it('adds TreeId to every owner-bearing table', async () => {
    const { db } = await boot();
    for (const t of TREE_SCOPED_TABLES) {
      const r = await db.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'TreeId'`,
        [t]
      );
      expect(r.rows.length, `${t}.TreeId missing`).toBe(1);
    }
    await db.close();
  });

  it('backfill creates one default tree per user and stamps legacy rows, idempotently', async () => {
    const { db, executor } = await boot();
    await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'bf@test.local', 'g-bf')`);
    // Legacy rows (no TreeId), one per owner-column flavor.
    await db.query(`INSERT INTO "People" ("Id", "UserId", "FirstName") VALUES (1, 1, 'Legacy')`);
    await db.query(`INSERT INTO "Sources" ("Id", "OwnerId", "Title") VALUES (1, 1, 'Legacy source')`);
    await db.query(
      `INSERT INTO "AuditLog" ("TreeOwnerId", "UserId", "Action", "EntityType", "EntityId", "Changes")
       VALUES (1, 1, 'create', 'person', 1, '{}')`
    );

    await initializeSchema(executor); // migration pass over the pre-existing data

    const trees = await db.query<{ Id: number; Name: string }>(
      `SELECT "Id", "Name" FROM "Trees" WHERE "OwnerId" = 1 ORDER BY "Id"`
    );
    expect(trees.rows.length).toBe(1); // exactly one default tree
    expect(trees.rows[0].Name).toBe('My Tree');
    const treeId = trees.rows[0].Id;

    const p = await db.query<{ TreeId: number }>(`SELECT "TreeId" FROM "People" WHERE "Id" = 1`);
    expect(p.rows[0].TreeId).toBe(treeId);
    const s = await db.query<{ TreeId: number }>(`SELECT "TreeId" FROM "Sources" WHERE "Id" = 1`);
    expect(s.rows[0].TreeId).toBe(treeId);
    const a = await db.query<{ TreeId: number }>(`SELECT "TreeId" FROM "AuditLog" WHERE "TreeOwnerId" = 1`);
    expect(a.rows[0].TreeId).toBe(treeId);

    // Re-running must not duplicate trees or restamp rows.
    await initializeSchema(executor);
    await initializeSchema(executor);
    const again = await db.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM "Trees" WHERE "OwnerId" = 1`);
    expect(parseInt(again.rows[0].c, 10)).toBe(1);
    await db.close();
  });

  it('leaves orphaned rows (NULL owner) unstamped', async () => {
    const { db, executor } = await boot();
    await db.query(`INSERT INTO "People" ("Id", "FirstName") VALUES (2, 'Orphan')`);
    await initializeSchema(executor);
    const p = await db.query<{ TreeId: number | null }>(`SELECT "TreeId" FROM "People" WHERE "Id" = 2`);
    expect(p.rows[0].TreeId).toBeNull();
    await db.close();
  });

  it('swaps TreeSharing uniqueness to (TreeId, SharedWithId)', async () => {
    const { db } = await boot();
    // Old account-level constraint gone…
    const oldCon = await db.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'TreeSharing_OwnerId_SharedWithId_key'`
    );
    expect(oldCon.rows.length).toBe(0);
    // …new per-tree unique index present.
    const idx = await db.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'TreeSharing' AND indexname = 'idx_sharing_tree_shared'`
    );
    expect(idx.rows.length).toBe(1);
    await db.close();
  });
});
