import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { buildPgliteSeed } from '@/lib/db/pglite-seed';
import { SCHEMA_VERSION } from '@/lib/db/init-schema';

// The first-visit starting database: what the worker loads instead of running initdb.
describe('buildPgliteSeed', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await PGlite.create({ loadDataDir: await buildPgliteSeed() });
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it('is at the current schema version, so the page skips the schema init', async () => {
    const v = await db.query<{ v: number }>('SELECT MAX("Version") AS v FROM "_SchemaMeta"');
    expect(v.rows[0].v).toBe(SCHEMA_VERSION);
  });

  it('holds no users, trees or people', async () => {
    const r = await db.query<{ users: number; trees: number; people: number }>(
      `SELECT (SELECT COUNT(*) FROM "Users")::int AS users, (SELECT COUNT(*) FROM "Trees")::int AS trees,
              (SELECT COUNT(*) FROM "People")::int AS people`,
    );
    expect(r.rows[0]).toEqual({ users: 0, trees: 0, people: 0 });
  });

  it('leaves the tables unanalyzed, so the first import is not planned for empty tables', async () => {
    const r = await db.query<{ reltuples: number }>(`SELECT reltuples FROM pg_class WHERE relname = 'People'`);
    expect(r.rows[0].reltuples).toBe(-1);
  });
});
