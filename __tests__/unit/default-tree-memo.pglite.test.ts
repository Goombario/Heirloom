import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { __setTestDb, query } from '@/lib/db/connection.pglite';
import { resolveDefaultTree, setDefaultTreeMemo } from '@/lib/db/queries/trees';
import { rememberDefaultTree } from '@/lib/data/local/default-tree';
import { dataCache } from '@/lib/data/cache';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

describe('local default-tree memo (#1269)', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    __setTestDb(db);
    await query('SELECT 1');
    await query(`INSERT INTO "Users" ("Id", "Email", "Name", "GoogleId") VALUES (1, 'local@example.test', 'Local', 'local-1') ON CONFLICT DO NOTHING`);
  });
  afterEach(async () => {
    setDefaultTreeMemo(null);
    __setTestDb(null);
    await db.close();
  });

  it('looks the default tree up once until the next write', async () => {
    rememberDefaultTree();
    const first = await resolveDefaultTree(1);
    const spy = vi.spyOn(db, 'query');
    expect(await resolveDefaultTree(1)).toBe(first);
    expect(spy).not.toHaveBeenCalled();
    dataCache.clear();
    expect(await resolveDefaultTree(1)).toBe(first);
    expect(spy).toHaveBeenCalled();
  });

  it('finds a replaced default tree after the write that replaced it', async () => {
    rememberDefaultTree();
    const first = await resolveDefaultTree(1);
    await query('DELETE FROM "Trees" WHERE "Id" = $1', [first]);
    dataCache.clear();
    const second = await resolveDefaultTree(1);
    expect(second).not.toBe(first);
  });
});
