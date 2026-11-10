import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

/**
 * Slice 4 backfill gate (G-MIG): distinct Sources."RepositoryName" strings are
 * promoted to Repository rows and the sources linked via "RepositoryId", once
 * per name, idempotently across repeated initializeSchema runs.
 */
async function boot(): Promise<{ db: PGlite; executor: DbExecutor }> {
  const db = await newEmptyClusterDb();
  const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
  await initializeSchema(executor);
  await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@b.c', 'g1')`);
  // Two sources share one archive; a third has none.
  await db.query(`INSERT INTO "Sources" ("OwnerId", "Title", "RepositoryName") VALUES (1, 'A', 'Diocesan Archive')`);
  await db.query(`INSERT INTO "Sources" ("OwnerId", "Title", "RepositoryName") VALUES (1, 'B', 'Diocesan Archive')`);
  await db.query(`INSERT INTO "Sources" ("OwnerId", "Title", "RepositoryName") VALUES (1, 'C', NULL)`);
  return { db, executor };
}

async function repoCount(db: PGlite): Promise<number> {
  const r = await db.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM "Repository"`);
  return parseInt(r.rows[0].c, 10);
}

describe('Repository backfill (Slice 4)', () => {
  it('creates one Repository per distinct name and links its sources', async () => {
    const { db, executor } = await boot();
    await initializeSchema(executor); // re-run to backfill rows inserted after first init

    expect(await repoCount(db)).toBe(1);
    const linked = await db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "Sources" s JOIN "Repository" r ON r."Id" = s."RepositoryId"
       WHERE r."Name" = 'Diocesan Archive'`
    );
    expect(parseInt(linked.rows[0].c, 10)).toBe(2);

    const unlinked = await db.query<{ RepositoryId: number | null }>(
      `SELECT "RepositoryId" FROM "Sources" WHERE "Title" = 'C'`
    );
    expect(unlinked.rows[0].RepositoryId).toBeNull();
    await db.close();
  });

  it('is idempotent — repeated init never duplicates the Repository (G-MIG)', async () => {
    const { db, executor } = await boot();
    await initializeSchema(executor);
    await initializeSchema(executor);
    await initializeSchema(executor);
    expect(await repoCount(db)).toBe(1);
    await db.close();
  });
});
