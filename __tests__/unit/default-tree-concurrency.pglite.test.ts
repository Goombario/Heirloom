import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// The static build's first import fires its preview, counts and import at once.
// Each resolved the default tree and found none, so a new browser got three
// "My tree"s and a later merge could land in another one (#1007).

const USER_ID = 1007;
let db: PGlite;

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'default-tree@test.local', 'default-tree']);
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

describe('resolveDefaultTree under concurrent first use (#1007)', () => {
  it('creates one tree, and every caller gets it', async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => resolveDefaultTree(USER_ID)));
    const trees = await query('SELECT "Id" FROM "Trees" WHERE "OwnerId" = $1', [USER_ID]);
    expect(trees.rows).toHaveLength(1);
    expect(new Set(ids)).toEqual(new Set([(trees.rows[0] as { Id: number }).Id]));
  });
});

describe('resolveDefaultTree lookups in the browser build (#1266)', () => {
  let lookupSpy: { mock: { calls: unknown[][] }; mockClear: () => void };
  const lookups = () => lookupSpy.mock.calls.filter(([text]) => String(text).includes('ORDER BY "Id" ASC LIMIT 1')).length;

  beforeAll(() => { lookupSpy = vi.spyOn(db, 'query'); });
  afterEach(() => { vi.unstubAllGlobals(); lookupSpy.mockClear(); });

  it('concurrent callers in the browser share one lookup', async () => {
    vi.stubGlobal('window', {});
    const ids = await Promise.all(Array.from({ length: 6 }, () => resolveDefaultTree(USER_ID)));
    expect(new Set(ids).size).toBe(1);
    expect(lookups()).toBe(1);
  });

  it('a settled lookup is not reused, so a changed default tree is seen', async () => {
    vi.stubGlobal('window', {});
    const first = await resolveDefaultTree(USER_ID);
    await query('DELETE FROM "Trees" WHERE "Id" = $1', [first]);
    const second = await resolveDefaultTree(USER_ID);
    expect(second).not.toBe(first);
  });

  it('the server runs each lookup on its own', async () => {
    await Promise.all(Array.from({ length: 3 }, () => resolveDefaultTree(USER_ID)));
    expect(lookups()).toBe(3);
  });
});
