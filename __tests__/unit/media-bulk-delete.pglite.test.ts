import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { __setTestDb, query } from '@/lib/db/connection.pglite';
import { ValidationError } from '@/lib/validation';
import { AccessError } from '@/lib/data/errors';
import { deleteMediaBatchService } from '@/lib/services/media';
import { LocalMediaClient } from '@/lib/data/local/media';
import { ensureLocalUser, __resetLocalUserCache } from '@/lib/data/local-user';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

describe('deleteMediaBatchService', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
  });

  beforeEach(async () => {
    await query('TRUNCATE "AuditLog", "MediaImportItem", "MediaFaceCandidate", "MediaTag", "MediaLink", "MediaBlob", "MediaThumb", "Media", "TreeSharing", "Trees", "Users" RESTART IDENTITY CASCADE');
    __resetLocalUserCache();
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES
      (1, 'bulk-owner@example.test', 'local-web'),
      (2, 'bulk-contributor@example.test', 'bulk-contributor')`);
    await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Bulk tree')`);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  async function media(title: string, treeId = 1): Promise<number> {
    const result = await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format", "ContentType")
       VALUES (1, $1, $2, $3, 'jpeg', 'image/jpeg') RETURNING "Id"`,
      [treeId, title, `${title}.jpg`],
    );
    return (result.rows[0] as { Id: number }).Id;
  }

  it('rejects malformed, empty, duplicate, non-positive, non-integer, and oversized requests before mutation', async () => {
    const existing = await media('untouched');
    const invalidInputs: unknown[] = [
      'not-an-array', [], [existing, existing], [0], [-1], [1.5], [101, 102, ...Array.from({ length: 99 }, (_, i) => i + 103)],
    ];

    for (const ids of invalidInputs) {
      await expect(deleteMediaBatchService({
        ids, requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1,
      })).rejects.toBeInstanceOf(ValidationError);
    }

    expect((await query('SELECT COUNT(*)::int AS n FROM "Media"')).rows[0].n).toBe(1);
  });

  it.each(['view', 'contribute'] as const)('denies %s permission before any mutation', async (permission) => {
    await query(
      `INSERT INTO "TreeSharing" ("TreeId", "OwnerId", "SharedWithId", "Permission") VALUES (1, 1, 2, $1)`,
      [permission],
    );
    const id = await media('protected');

    await expect(deleteMediaBatchService({
      ids: [id], requestedTreeId: 1, requestedOwnerId: null, currentUserId: 2,
    })).rejects.toBeInstanceOf(AccessError);
    expect((await query('SELECT COUNT(*)::int AS n FROM "Media"')).rows[0].n).toBe(1);
    expect((await query('SELECT COUNT(*)::int AS n FROM "AuditLog"')).rows[0].n).toBe(0);
  });

  it('returns deterministic mixed outcomes and cascades all media dependents', async () => {
    const first = await media('first');
    const second = await media('second');
    await query(`INSERT INTO "People" ("Id", "UserId", "TreeId", "FirstName") VALUES (9, 1, 1, 'Fictional')`);
    await query(`INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH") VALUES ($1, 9, 1, 2, 3, 4)`, [first]);
    await query(`INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId") VALUES ($1, 'People', 9)`, [first]);
    await query(`INSERT INTO "MediaBlob" ("MediaId", "Data") VALUES ($1, decode('00', 'hex'))`, [first]);
    await query(`INSERT INTO "MediaThumb" ("MediaId", "Data") VALUES ($1, decode('01', 'hex'))`, [first]);
    await query(`INSERT INTO "MediaImportItem" ("ImportId", "DocumentMediaId", "TreeId", "MediaId", "ArchivePath", "OriginalFilename", "Status", "SkipFaceCapture") VALUES ('i', 'm', 1, $1, 'a.jpg', 'a.jpg', 'ready', 0)`, [first]);

    const result = await deleteMediaBatchService({
      ids: [second, 999999, first], requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1,
    });

    expect(result).toEqual({
      results: [
        { id: second, status: 'deleted', cleanupWarning: null },
        { id: 999999, status: 'skipped', code: 'not_found', retryable: false },
        { id: first, status: 'deleted', cleanupWarning: null },
      ],
      deletedCount: 2,
      skippedCount: 1,
      failedCount: 0,
      cleanupWarningCount: 0,
    });
    expect((await query(`SELECT COUNT(*)::int AS n FROM "AuditLog" WHERE "Action" = 'delete' AND "EntityType" = 'media'`)).rows[0].n).toBe(2);
    for (const table of ['MediaTag', 'MediaLink', 'MediaBlob', 'MediaThumb', 'MediaImportItem']) {
      expect((await query(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE "MediaId" = $1`, [first])).rows[0].n).toBe(0);
    }
  });

  it('returns a retryable failure and retries only that item without duplicating successful audits', async () => {
    const good = await media('good');
    const retry = await media('retry');
    await query(`CREATE OR REPLACE FUNCTION "fail_retry_media"() RETURNS trigger AS $$
      BEGIN IF OLD."Title" = 'retry' THEN RAISE EXCEPTION 'forced delete failure'; END IF; RETURN OLD; END;
      $$ LANGUAGE plpgsql`);
    await query(`CREATE TRIGGER "fail_retry_media_trigger" BEFORE DELETE ON "Media" FOR EACH ROW EXECUTE FUNCTION "fail_retry_media"()`);

    try {
      const first = await deleteMediaBatchService({ ids: [good, retry], requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1 });
      expect(first.results).toEqual([
        { id: good, status: 'deleted', cleanupWarning: null },
        { id: retry, status: 'failed', code: 'delete_failed', retryable: true },
      ]);
    } finally {
      await query(`DROP TRIGGER IF EXISTS "fail_retry_media_trigger" ON "Media"`);
      await query(`DROP FUNCTION IF EXISTS "fail_retry_media"()`);
    }

    const second = await deleteMediaBatchService({ ids: [retry], requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1 });
    expect(second.results).toEqual([{ id: retry, status: 'deleted', cleanupWarning: null }]);
    expect((await query(`SELECT COUNT(*)::int AS n FROM "AuditLog" WHERE "Action" = 'delete' AND "EntityType" = 'media'`)).rows[0].n).toBe(2);
  });

  it('returns the same ordered result shape through the local data client', async () => {
    const currentUserId = await ensureLocalUser();
    const tree = (await query(
      'SELECT "Id" FROM "Trees" WHERE "OwnerId" = $1 ORDER BY "Id" LIMIT 1',
      [currentUserId],
    )).rows[0] as { Id: number };
    const inserted = (await query(
      'INSERT INTO "Media" ("UserId", "TreeId", "Title") VALUES ($1, $2, $3) RETURNING "Id"',
      [currentUserId, tree.Id, 'local-delete'],
    )).rows[0] as { Id: number };

    const result = await new LocalMediaClient().removeMany([inserted.Id, 999999], tree.Id);
    expect(result).toEqual({
      results: [
        { id: inserted.Id, status: 'deleted', cleanupWarning: null },
        { id: 999999, status: 'skipped', code: 'not_found', retryable: false },
      ],
      deletedCount: 1,
      skippedCount: 1,
      failedCount: 0,
      cleanupWarningCount: 0,
    });
  });
});
