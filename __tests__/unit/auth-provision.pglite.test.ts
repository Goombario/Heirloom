import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

// Redirect the query layer onto in-memory PGlite (same pattern as local-client).
vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

import { resolveOrCreateUser } from '@/lib/auth/provision';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';

let db: PGlite;

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('SELECT 1'); // boot WASM + run schema init once
});

beforeEach(async () => {
  await truncateAllTables(db);
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

async function userCount(): Promise<number> {
  const r = await query('SELECT COUNT(*)::int AS c FROM "Users"');
  return (r.rows[0] as { c: number }).c;
}

describe('resolveOrCreateUser (auth provisioning)', () => {
  it('creates a new user on first sign-in', async () => {
    const u = await resolveOrCreateUser({ googleId: 'g-1', email: 'ada@example.com', name: 'Ada', image: null });
    expect(u.id).toBeGreaterThan(0);
    expect(u.email).toBe('ada@example.com');
    expect(u.name).toBe('Ada');
    expect(await userCount()).toBe(1);
  });

  it('is idempotent by GoogleId — repeat sign-ins reuse the row', async () => {
    const a = await resolveOrCreateUser({ googleId: 'g-1', email: 'ada@example.com', name: 'Ada', image: null });
    const b = await resolveOrCreateUser({ googleId: 'g-1', email: 'ada@example.com', name: 'Ada', image: null });
    expect(b.id).toBe(a.id);
    expect(await userCount()).toBe(1);
  });

  it('links a new GoogleId onto an existing row matched by email (no duplicate)', async () => {
    const first = await resolveOrCreateUser({ googleId: 'old-sub', email: 'grace@example.com', name: 'Grace', image: null });
    const relinked = await resolveOrCreateUser({ googleId: 'new-sub', email: 'grace@example.com', name: 'Grace H.', image: null });
    expect(relinked.id).toBe(first.id);
    const row = await query('SELECT "GoogleId" FROM "Users" WHERE "Id" = $1', [first.id]);
    expect((row.rows[0] as { GoogleId: string }).GoogleId).toBe('new-sub');
    expect(await userCount()).toBe(1);
  });

  it('keeps distinct Google accounts as separate users', async () => {
    const a = await resolveOrCreateUser({ googleId: 'g-a', email: 'a@example.com', name: 'A', image: null });
    const b = await resolveOrCreateUser({ googleId: 'g-b', email: 'b@example.com', name: 'B', image: null });
    expect(b.id).not.toBe(a.id);
    expect(await userCount()).toBe(2);
  });
});
