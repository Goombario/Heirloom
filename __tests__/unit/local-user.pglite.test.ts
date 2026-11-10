import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

// Redirect the connection module to the PGlite implementation for this test.
vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { ensureLocalUser, __resetLocalUserCache } from '@/lib/data/local-user';
import { truncateAllTables } from '../setup/pglite-truncate';

let db: PGlite;

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('SELECT 1'); // boot WASM + run schema init ONCE for the whole file
});

beforeEach(async () => {
  await truncateAllTables(db);
  __resetLocalUserCache();
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

describe('ensureLocalUser', () => {
  it('creates the local user once and returns a stable id', async () => {
    const id1 = await ensureLocalUser();
    expect(id1).toBeGreaterThan(0);
    const id2 = await ensureLocalUser();
    expect(id2).toBe(id1);

    const res = await db.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM "Users" WHERE "GoogleId" = 'local-web'`
    );
    expect(res.rows[0].c).toBe(1);
  });

  it('returns one id for concurrent first calls without double-inserting', async () => {
    const [a, b, c] = await Promise.all([
      ensureLocalUser(),
      ensureLocalUser(),
      ensureLocalUser(),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);

    const res = await db.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM "Users" WHERE "GoogleId" = 'local-web'`
    );
    expect(res.rows[0].c).toBe(1);
  });
});
