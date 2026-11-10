import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

let db: PGlite | undefined;

function executorFor(database: PGlite): DbExecutor {
  return { query: (text, params) => database.query(text, params) };
}

async function addV34CompatibilityContract(database: PGlite): Promise<void> {
  await database.query(`ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "PersonId" INTEGER`);
  await database.query(`ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "IsPrimary" INTEGER DEFAULT 0`);
  await database.query(`ALTER TABLE "MediaTag" ADD COLUMN IF NOT EXISTS "IsPrimary" INTEGER NOT NULL DEFAULT 0`);
  await database.query(`CREATE INDEX IF NOT EXISTS idx_media_personid ON "Media"("PersonId")`);
  await database.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mediatag_one_primary
      ON "MediaTag"("PersonId") WHERE "IsPrimary" = 1
  `);
}

async function canonicalSnapshot(database: PGlite): Promise<Record<string, unknown[]>> {
  const media = await database.query(`
    SELECT "Id", "UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FocalX", "FocalY"
    FROM "Media"
    ORDER BY "Id"
  `);
  const links = await database.query(`
    SELECT "MediaId", "OwnerTable", "OwnerId", "IsPrimary"
    FROM "MediaLink"
    ORDER BY "MediaId", "OwnerTable", "OwnerId"
  `);
  const tags = await database.query(`
    SELECT "Id", "MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH"
    FROM "MediaTag"
    ORDER BY "Id"
  `);
  const auditLog = await database.query(`
    SELECT "Id", "TreeOwnerId", "TreeId", "UserId", "Action", "EntityType", "EntityId", "Changes"
    FROM "AuditLog"
    ORDER BY "Id"
  `);

  return {
    media: media.rows,
    links: links.rows,
    tags: tags.rows,
    auditLog: auditLog.rows,
  };
}

describe('schema v35 media compatibility contract', () => {
  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it('preserves canonical ownership, primary state, geometry, and audit history while dropping v34 columns', async () => {
    db = await newEmptyClusterDb();
    const executor = executorFor(db);
    await initializeSchema(executor);
    await addV34CompatibilityContract(db);

    await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'fixture@example.test', 'fixture')`);
    await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (100, 1, 'Fixture Tree')`);
    await db.query(`
      INSERT INTO "People" ("Id", "UserId", "TreeId", "FirstName") VALUES
        (5, 1, 100, 'Alice'),
        (6, 1, 100, 'Bob')
    `);
    await db.query(`INSERT INTO "Families" ("Id", "UserId", "TreeId") VALUES (20, 1, 100)`);
    await db.query(`
      INSERT INTO "Media"
        ("Id", "UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FocalX", "FocalY", "PersonId", "IsPrimary")
      VALUES
        (10, 1, 100, 'Tagged primary', 'a/portrait.jpg', 'jpg', 'image/jpeg', 12.5, 37.5, 5, 1),
        (11, 1, 100, 'Untagged primary', 'b/portrait.jpg', 'jpg', 'image/jpeg', 52.5, 67.5, 6, 1),
        (12, 1, 100, 'Shared', 'shared.jpg', 'jpg', 'image/jpeg', 50, 50, 5, 0),
        (13, 1, 100, 'Ownerless', 'ownerless.jpg', 'jpg', 'image/jpeg', 50, 50, NULL, 0)
    `);
    await db.query(`
      INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES
        (10, 'People', 5, 1),
        (11, 'People', 6, 1),
        (12, 'People', 5, 0),
        (12, 'People', 6, 0),
        (12, 'Families', 20, 0)
    `);
    await db.query(`
      INSERT INTO "MediaTag"
        ("Id", "MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH", "IsPrimary")
      VALUES
        (30, 10, 5, 10, 20, 30, 40, 1),
        (31, 12, 6, 15, 25, 35, 45, 0)
    `);
    await db.query(`
      INSERT INTO "AuditLog"
        ("Id", "TreeOwnerId", "TreeId", "UserId", "Action", "EntityType", "EntityId", "Changes")
      VALUES (40, 1, 100, 1, 'update', 'media', 10, '{"title":{"old":"Before","new":"After"}}')
    `);

    const before = await canonicalSnapshot(db);

    await initializeSchema(executor);

    expect(await canonicalSnapshot(db)).toEqual(before);
    const columns = await db.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'Media' AND column_name IN ('PersonId', 'IsPrimary'))
          OR (table_name = 'MediaTag' AND column_name = 'IsPrimary')
        )
      ORDER BY table_name, column_name
    `);
    expect(columns.rows).toEqual([]);

    await initializeSchema(executor);
    expect(await canonicalSnapshot(db)).toEqual(before);
  });

  it('fails closed and retains all compatibility evidence when a legacy owner is invalid', async () => {
    db = await newEmptyClusterDb();
    const executor = executorFor(db);
    await initializeSchema(executor);
    await addV34CompatibilityContract(db);
    await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'invalid@example.test', 'invalid')`);
    await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (100, 1, 'Invalid Fixture')`);
    await db.query(`
      INSERT INTO "Media" ("Id", "UserId", "TreeId", "Title", "PersonId", "IsPrimary")
      VALUES (10, 1, 100, 'Invalid owner evidence', 999, 1)
    `);

    await expect(initializeSchema(executor)).rejects.toThrow(
      'Cannot retire v34 media compatibility contract',
    );
    expect((await db.query(`SELECT "PersonId", "IsPrimary" FROM "Media" WHERE "Id" = 10`)).rows)
      .toEqual([{ PersonId: 999, IsPrimary: 1 }]);
  });

  it('fails closed on a partial compatibility contract', async () => {
    db = await newEmptyClusterDb();
    const executor = executorFor(db);
    await initializeSchema(executor);
    await db.query(`ALTER TABLE "Media" ADD COLUMN "PersonId" INTEGER`);

    await expect(initializeSchema(executor)).rejects.toThrow(
      'Cannot retire partial v34 media compatibility contract (1/3 columns present)',
    );
  });

  it.each([
    ['Families', 999],
    ['Events', 999],
    ['Sources', 999],
    ['UnknownOwner', 999],
  ])('fails closed when a canonical %s owner is invalid', async (ownerTable, ownerId) => {
    db = await newEmptyClusterDb();
    const executor = executorFor(db);
    await initializeSchema(executor);
    await addV34CompatibilityContract(db);
    await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'canonical-invalid@example.test', 'canonical-invalid')`);
    await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (100, 1, 'Canonical Invalid Fixture')`);
    await db.query(`
      INSERT INTO "Media" ("Id", "UserId", "TreeId", "Title", "PersonId", "IsPrimary")
      VALUES (10, 1, 100, 'Invalid canonical owner evidence', NULL, 0)
    `);
    await db.query(
      `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES (10, $1, $2, 0)`,
      [ownerTable, ownerId],
    );

    await expect(initializeSchema(executor)).rejects.toThrow(
      'Cannot retire v34 media compatibility contract',
    );
    expect((await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'Media' AND column_name IN ('PersonId', 'IsPrimary'))
          OR (table_name = 'MediaTag' AND column_name = 'IsPrimary')
        )
    `)).rows).toHaveLength(3);
  });

  it('fails closed when a canonical owner exists in a different tree', async () => {
    db = await newEmptyClusterDb();
    const executor = executorFor(db);
    await initializeSchema(executor);
    await addV34CompatibilityContract(db);
    await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'cross-tree@example.test', 'cross-tree')`);
    await db.query(`
      INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES
        (100, 1, 'Media Tree'),
        (101, 1, 'Owner Tree')
    `);
    await db.query(`INSERT INTO "Families" ("Id", "UserId", "TreeId") VALUES (20, 1, 101)`);
    await db.query(`
      INSERT INTO "Media" ("Id", "UserId", "TreeId", "Title", "PersonId", "IsPrimary")
      VALUES (10, 1, 100, 'Cross-tree canonical evidence', NULL, 0)
    `);
    await db.query(`
      INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary")
      VALUES (10, 'Families', 20, 0)
    `);

    await expect(initializeSchema(executor)).rejects.toThrow(
      'Cannot retire v34 media compatibility contract',
    );
  });
});
