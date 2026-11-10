import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb, hasBackupWorthyData } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';

/** #938: the backup warnings wait until there's a person. */
describe('hasBackupWorthyData', () => {
  let db: PGlite;
  beforeAll(async () => { db = await newEmptyClusterDb(); __setTestDb(db); await query('SELECT 1'); });
  beforeEach(async () => {
    await truncateAllTables(db);
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@b.c', 'g1')`);
    await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'A')`);
  });
  afterAll(async () => { __setTestDb(null); await db.close(); });

  it('is false for an empty app, even with a tree', async () => {
    expect(await hasBackupWorthyData()).toBe(false);
  });

  it('stays false with only a photo or a source', async () => {
    await query(`INSERT INTO "Media" ("UserId", "TreeId", "Title") VALUES (1, 1, 'Photo')`);
    await query(`INSERT INTO "Sources" ("OwnerId", "TreeId", "Title") VALUES (1, 1, 'Census')`);
    expect(await hasBackupWorthyData()).toBe(false);
  });

  it('is true once there is a person', async () => {
    await query(`INSERT INTO "People" ("UserId", "TreeId", "FirstName") VALUES (1, 1, 'Ada')`);
    expect(await hasBackupWorthyData()).toBe(true);
  });
});
