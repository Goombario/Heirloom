import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import { inspectMediaLinkIntegrity } from '@/lib/db/queries/media-links';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

let db: PGlite | undefined;

async function bootSchema(): Promise<{ db: PGlite; executor: DbExecutor }> {
  db = await newEmptyClusterDb();
  const executor: DbExecutor = { query: (text, params) => db!.query(text, params) };
  await initializeSchema(executor);
  await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'fixture@example.test', 'fixture')`);
  await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (100, 1, 'A'), (200, 1, 'B')`);
  await db.query(`
    INSERT INTO "People" ("Id", "UserId", "TreeId", "FirstName") VALUES
      (5, 1, 100, 'Alice'),
      (6, 1, 100, 'Bob'),
      (7, 1, 200, 'Charlie')
  `);
  return { db, executor };
}

describe('MediaLink canonical state after the v35 contract', () => {
  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it('preserves shared and owner-specific primary links across schema reinitialization', async () => {
    const fixture = await bootSchema();
    await fixture.db.query(`
      INSERT INTO "Media" ("Id", "UserId", "TreeId", "Title") VALUES
        (10, 1, 100, 'Shared'),
        (11, 1, 100, 'Secondary')
    `);
    await fixture.db.query(`
      INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES
        (10, 'People', 5, 1),
        (10, 'People', 6, 0),
        (11, 'People', 6, 1)
    `);

    await initializeSchema(fixture.executor);
    await initializeSchema(fixture.executor);

    expect((await fixture.db.query(`
      SELECT "MediaId", "OwnerId", "IsPrimary"
      FROM "MediaLink"
      ORDER BY "OwnerId", "MediaId"
    `)).rows).toEqual([
      { MediaId: 10, OwnerId: 5, IsPrimary: 1 },
      { MediaId: 10, OwnerId: 6, IsPrimary: 0 },
      { MediaId: 11, OwnerId: 6, IsPrimary: 1 },
    ]);
    expect(await inspectMediaLinkIntegrity(100, fixture.executor)).toEqual({ issues: [] });
  });

  it('reports missing and cross-tree canonical owners without legacy storage', async () => {
    const fixture = await bootSchema();
    await fixture.db.query(`INSERT INTO "Media" ("Id", "UserId", "TreeId", "Title") VALUES (10, 1, 100, 'Audit')`);
    await fixture.db.query(`
      INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES
        (10, 'People', 999, 0),
        (10, 'People', 7, 0)
    `);

    expect(await inspectMediaLinkIntegrity(100, fixture.executor)).toEqual({
      issues: [
        { kind: 'cross_tree_owner', mediaId: 10, ownerTable: 'People', ownerId: 7 },
        { kind: 'missing_owner', mediaId: 10, ownerTable: 'People', ownerId: 999 },
      ],
    });
  });
});
