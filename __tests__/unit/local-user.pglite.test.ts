import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

// Redirect the connection module to the PGlite implementation for this test.
vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// Pass through to the real query, so one test can make the first lookup miss.
vi.mock('@/lib/db/queries/users', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db/queries/users')>();
  return { ...real, getUserSummaryByGoogleId: vi.fn(real.getUserSummaryByGoogleId) };
});

import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { getUserSummaryByGoogleId } from '@/lib/db/queries/users';
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

  it('reads the row another tab inserted between its lookup and its insert', async () => {
    // The other tab's insert, which this tab's lookup ran too early to see.
    const other = await db.query<{ Id: number }>(
      `INSERT INTO "Users" ("Email", "Name", "GoogleId") VALUES ('local@web', 'Local User', 'local-web') RETURNING "Id"`
    );
    vi.mocked(getUserSummaryByGoogleId).mockResolvedValueOnce(null);

    expect(await ensureLocalUser()).toBe(other.rows[0].Id);
    const res = await db.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM "Users" WHERE "GoogleId" = 'local-web'`
    );
    expect(res.rows[0].c).toBe(1);
  });
});
