import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import {
  createMediaImportItem,
  deleteUnresolvedMediaImportItem,
  listUnresolvedMediaImportItems,
  lockMediaImportItem,
  transitionMediaImportItem,
} from '@/lib/db/queries/media-import-items';

import { newEmptyClusterDb } from '../setup/pglite-snapshot';

let db: PGlite | undefined;

async function bootSchema(): Promise<{ db: PGlite; executor: DbExecutor }> {
  db = await newEmptyClusterDb();
  const executor: DbExecutor = { query: (text, params) => db!.query(text, params) };
  await initializeSchema(executor);
  await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'fixture@example.test', 'fixture')`);
  await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (100, 1, 'A'), (200, 1, 'B')`);
  await db.query(`
    INSERT INTO "Media" ("Id", "UserId", "TreeId", "Title") VALUES
      (10, 1, 100, 'A'),
      (11, 1, 100, 'B'),
      (12, 1, 200, 'C'),
      (13, 1, 100, 'D')
  `);
  return { db, executor };
}

function itemInput(overrides: Partial<Parameters<typeof createMediaImportItem>[0]> = {}) {
  return {
    importId: 'import-1',
    documentMediaId: '@M1@',
    treeId: 100,
    mediaId: 10,
    archivePath: 'photos/family..jpg',
    originalFilename: 'family..jpg',
    status: 'pending' as const,
    failureCode: null,
    skipFaceCapture: false,
    ...overrides,
  };
}

describe('MediaImportItem schema and queries', () => {
  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it('enforces status/failure, non-empty path, and boolean invariants', async () => {
    const fixture = await bootSchema();

    await expect(fixture.db.query(`
      INSERT INTO "MediaImportItem"
        ("ImportId", "DocumentMediaId", "TreeId", "MediaId", "ArchivePath", "OriginalFilename", "Status", "FailureCode")
      VALUES ('bad-status', '@1@', 100, 10, 'a.jpg', 'a.jpg', 'pending', 'decode_failed')
    `)).rejects.toThrow();
    await expect(fixture.db.query(`
      INSERT INTO "MediaImportItem"
        ("ImportId", "DocumentMediaId", "TreeId", "MediaId", "ArchivePath", "OriginalFilename", "Status")
      VALUES ('bad-failure', '@2@', 100, 11, 'a.jpg', 'a.jpg', 'missing')
    `)).rejects.toThrow();
    await expect(fixture.db.query(`
      INSERT INTO "MediaImportItem"
        ("ImportId", "DocumentMediaId", "TreeId", "MediaId", "ArchivePath", "OriginalFilename")
      VALUES ('bad-path', '@3@', 100, 11, '', 'a.jpg')
    `)).rejects.toThrow();
    await expect(fixture.db.query(`
      INSERT INTO "MediaImportItem"
        ("ImportId", "DocumentMediaId", "TreeId", "MediaId", "ArchivePath", "OriginalFilename", "SkipFaceCapture")
      VALUES ('bad-flag', '@4@', 100, 11, 'a.jpg', 'a.jpg', 2)
    `)).rejects.toThrow();
  });

  it('enforces unique MediaId and import/document identity', async () => {
    const fixture = await bootSchema();
    await createMediaImportItem(itemInput(), fixture.executor);

    await expect(createMediaImportItem(itemInput({ importId: 'import-2', documentMediaId: '@M2@' }), fixture.executor))
      .rejects.toThrow();
    await expect(createMediaImportItem(itemInput({ mediaId: 11 }), fixture.executor))
      .rejects.toThrow();
  });

  it('cascades the import item when its Media row is deleted', async () => {
    const fixture = await bootSchema();
    await createMediaImportItem(itemInput(), fixture.executor);

    await fixture.db.query(`DELETE FROM "Media" WHERE "Id" = 10`);
    const result = await fixture.db.query(`SELECT COUNT(*)::int AS "count" FROM "MediaImportItem"`);
    expect(result.rows).toEqual([{ count: 0 }]);
  });

  it('preserves item values across repeated schema initialization', async () => {
    const fixture = await bootSchema();
    const created = await createMediaImportItem(itemInput({ skipFaceCapture: true }), fixture.executor);

    await initializeSchema(fixture.executor);
    await initializeSchema(fixture.executor);

    expect(await lockMediaImportItem(created.id, 100, fixture.executor)).toMatchObject(created);
  });

  it('lists unresolved items in Id order and scopes by tree', async () => {
    const fixture = await bootSchema();
    await createMediaImportItem(itemInput({ documentMediaId: '@M1@', mediaId: 10, status: 'pending' }), fixture.executor);
    await createMediaImportItem(itemInput({ documentMediaId: '@M2@', mediaId: 11, status: 'missing', failureCode: 'archive_file_missing' }), fixture.executor);
    await createMediaImportItem(itemInput({ documentMediaId: '@M3@', mediaId: 12, treeId: 200, status: 'pending' }), fixture.executor);
    await createMediaImportItem(itemInput({ documentMediaId: '@M4@', mediaId: 13, status: 'ready' }), fixture.executor);

    const unresolved = await listUnresolvedMediaImportItems(100, fixture.executor);
    expect(unresolved.map((item) => [item.id, item.status])).toEqual([
      [1, 'pending'],
      [2, 'missing'],
    ]);
  });

  it('locks, transitions, and removes only unresolved items', async () => {
    const fixture = await bootSchema();
    const pending = await createMediaImportItem(itemInput(), fixture.executor);
    const ready = await createMediaImportItem(itemInput({ importId: 'import-2', documentMediaId: '@M2@', mediaId: 11, status: 'ready' }), fixture.executor);

    expect(await lockMediaImportItem(pending.id, 100, fixture.executor)).toMatchObject({ id: pending.id });
    const transitioned = await transitionMediaImportItem(
      pending.id,
      100,
      'failed',
      'decode_failed',
      fixture.executor,
    );
    expect(transitioned).toMatchObject({ status: 'failed', failureCode: 'decode_failed' });

    expect(await deleteUnresolvedMediaImportItem(pending.id, 100, fixture.executor)).toMatchObject({ mediaId: 10 });
    expect(await deleteUnresolvedMediaImportItem(ready.id, 100, fixture.executor)).toBeNull();
    expect((await fixture.db.query(`SELECT "Id" FROM "Media" ORDER BY "Id"`)).rows).toEqual([
      { Id: 10 },
      { Id: 11 },
      { Id: 12 },
      { Id: 13 },
    ]);
  });
});
