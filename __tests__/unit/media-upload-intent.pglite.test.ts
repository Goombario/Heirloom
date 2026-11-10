import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { truncateAllTables } from '../setup/pglite-truncate';
import { LocalDataClient } from '@/lib/data/local';
import { __resetLocalUserCache } from '@/lib/data/local-user';
import { __setTestDb, query } from '@/lib/db/connection.pglite';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

const INTENT = '123e4567-e89b-12d3-a456-426614174000';
const OTHER_INTENT = '123e4567-e89b-12d3-a456-426614174001';
const THIRD_INTENT = '123e4567-e89b-12d3-a456-426614174002';

function executorFor(database: PGlite): DbExecutor {
  return { query: (text, params) => database.query(text, params) };
}

async function count(table: 'Media' | 'MediaBlob' | 'MediaLink'): Promise<number> {
  const result = await query(`SELECT count(*)::int AS n FROM "${table}"`);
  return (result.rows[0] as { n: number }).n;
}

function imageFile(bytes = '<svg xmlns="http://www.w3.org/2000/svg"/>', name = 'staged.svg'): File {
  return new File([bytes], name, { type: 'image/svg+xml' });
}

describe('schema v37 upload-intent migration', () => {
  it('preserves v36 Media rows and adds a nullable upload intent plus partial unique tree index', async () => {
    const db = await newEmptyClusterDb();
    try {
      const executor = executorFor(db);
      await initializeSchema(executor);
      // Model a database that was initialized at v36 even when this checkout's
      // baseline schema already knows about v37. The migration under test must
      // add both artifacts back after this deliberate downgrade.
      await db.query(`DROP INDEX IF EXISTS "idx_media_tree_upload_intent"`);
      await db.query(`ALTER TABLE "Media" DROP COLUMN IF EXISTS "UploadIntentId"`);
      await db.query(`ALTER TABLE "Media" DROP COLUMN IF EXISTS "UploadIntentTarget"`);
      await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'v36@example.test', 'v36')`);
      await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (71, 1, 'v36 tree')`);
      await db.query(`
        INSERT INTO "Media"
          ("Id", "UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FileSize", "ContentHash")
        VALUES (901, 1, 71, 'Existing v36 media', 'existing.svg', 'SVG', 'image/svg+xml', 8, 'legacy-hash')
      `);
      await db.query(`INSERT INTO "MediaBlob" ("MediaId", "Data") VALUES (901, $1)`, [new Uint8Array([1, 2, 3])]);
      const before = await db.query<Record<string, unknown>>(`
        SELECT "Id", "UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FileSize", "ContentHash"
        FROM "Media" WHERE "Id" = 901
      `);

      await initializeSchema(executor);

      expect((await db.query(`
        SELECT "Id", "UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FileSize", "ContentHash", "UploadIntentId", "UploadIntentTarget"
        FROM "Media" WHERE "Id" = 901
      `)).rows).toEqual([{ ...before.rows[0], UploadIntentId: null, UploadIntentTarget: null }]);
      expect((await db.query(`SELECT "Data" FROM "MediaBlob" WHERE "MediaId" = 901`)).rows)
        .toEqual([{ Data: new Uint8Array([1, 2, 3]) }]);

      const column = await db.query<{ is_nullable: string; data_type: string }>(`
        SELECT is_nullable, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Media' AND column_name = 'UploadIntentId'
      `);
      expect(column.rows).toEqual([{ is_nullable: 'YES', data_type: 'text' }]);

      const targetColumn = await db.query<{ is_nullable: string; data_type: string }>(`
        SELECT is_nullable, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Media' AND column_name = 'UploadIntentTarget'
      `);
      expect(targetColumn.rows).toEqual([{ is_nullable: 'YES', data_type: 'text' }]);

      const indexes = await db.query<{ indexname: string; indexdef: string }>(`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'Media' AND indexname = 'idx_media_tree_upload_intent'
      `);
      expect(indexes.rows).toHaveLength(1);
      expect(indexes.rows[0].indexdef).toMatch(/UNIQUE INDEX/i);
      expect(indexes.rows[0].indexdef).toContain('(\"TreeId\", \"UploadIntentId\")');
      expect(indexes.rows[0].indexdef).toMatch(/UploadIntentId.*IS NOT NULL/i);

      await initializeSchema(executor);
      expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "Media"`)).rows[0].n).toBe(1);
    } finally {
      await db.close();
    }
  });

  it('creates the same nullable column and partial index on a fresh schema', async () => {
    const db = await newEmptyClusterDb();
    try {
      await initializeSchema(executorFor(db));
      const column = await db.query<{ is_nullable: string; column_default: string | null }>(`
        SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Media' AND column_name = 'UploadIntentId'
      `);
      expect(column.rows).toEqual([{ is_nullable: 'YES', column_default: null }]);
      expect((await db.query(`
        SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Media' AND column_name = 'UploadIntentTarget'
      `)).rows).toEqual([{ is_nullable: 'YES', column_default: null }]);

      await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'fresh@example.test', 'fresh')`);
      await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (72, 1, 'fresh tree')`);
      await db.query(`INSERT INTO "Media" ("Id", "UserId", "TreeId", "Title") VALUES (902, 1, 72, 'No intent')`);
      expect((await db.query(`SELECT "UploadIntentId" FROM "Media" WHERE "Id" = 902`)).rows)
        .toEqual([{ UploadIntentId: null }]);
      expect((await db.query(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'Media' AND indexname = 'idx_media_tree_upload_intent'
      `)).rows).toEqual([{ indexname: 'idx_media_tree_upload_intent' }]);
    } finally {
      await db.close();
    }
  });
});

describe('LocalMediaClient upload intents', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    await initializeSchema(executorFor(db));
    __setTestDb(db);
    await query('SELECT 1');
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    __resetLocalUserCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  async function event(client: LocalDataClient, treeId?: number): Promise<{ id: number; treeId: number }> {
    const person = await client.people.create({ FirstName: 'Staged', LastName: 'Owner' }, treeId == null ? undefined : { treeId });
    const created = await client.events.create({ Type: 'EVEN', PersonId: person.Id }, treeId);
    return { id: created.Id, treeId: created.TreeId! };
  }

  async function upload(client: LocalDataClient, owner: { id: number; treeId: number }, uploadIntentId: string, bytes = '<svg xmlns="http://www.w3.org/2000/svg"/>'): Promise<{ Id: number; UploadIntentId?: string | null }> {
    return client.media.upload({
      file: imageFile(bytes),
      ownerTable: 'Events',
      ownerRecordId: owner.id,
      uploadIntentId,
    }, owner.treeId);
  }

  it('replaying the same bytes and intent for one Events owner returns the same ID and one canonical row/link/blob', async () => {
    const client = new LocalDataClient();
    const owner = await event(client);
    const first = await upload(client, owner, INTENT);
    const second = await upload(client, owner, INTENT);

    expect(second.Id).toBe(first.Id);
    expect(await count('Media')).toBe(1);
    expect(await count('MediaBlob')).toBe(1);
    expect(await count('MediaLink')).toBe(1);
    expect((await query(`SELECT "UploadIntentId", "UploadIntentTarget" FROM "Media" WHERE "Id" = $1`, [first.Id])).rows)
      .toEqual([{
        UploadIntentId: INTENT,
        UploadIntentTarget: JSON.stringify({ caseId: null, owner: { id: owner.id, table: 'Events' }, personId: null }),
      }]);
    expect((await query(`SELECT "OwnerTable", "OwnerId" FROM "MediaLink" WHERE "MediaId" = $1`, [first.Id])).rows)
      .toEqual([{ OwnerTable: 'Events', OwnerId: owner.id }]);
  });

  it('different intents deliberately create duplicate media rows for the same Events owner', async () => {
    const client = new LocalDataClient();
    const owner = await event(client);
    const first = await upload(client, owner, INTENT);
    const second = await upload(client, owner, OTHER_INTENT);

    expect(second.Id).not.toBe(first.Id);
    expect(await count('Media')).toBe(2);
    expect(await count('MediaBlob')).toBe(2);
    expect(await count('MediaLink')).toBe(2);
  });

  it.each([
    ['different original content', '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'],
    ['different owner target', undefined],
  ] as const)('rejects a reused intent with %s as a stable conflict and leaves the original row intact', async (kind, changedBytes) => {
    const client = new LocalDataClient();
    const firstOwner = await event(client);
    const secondOwner = kind === 'different owner target' ? await event(client) : firstOwner;
    await upload(client, firstOwner, INTENT);

    await expect(upload(client, secondOwner, INTENT, changedBytes ?? '<svg xmlns="http://www.w3.org/2000/svg"/>'))
      .rejects.toMatchObject({ code: 'upload_intent_conflict', retryable: false });
    expect(await count('Media')).toBe(1);
    expect(await count('MediaBlob')).toBe(1);
    expect(await count('MediaLink')).toBe(1);
  });

  it('rejects a reused intent when the original owner target is omitted on replay', async () => {
    const client = new LocalDataClient();
    const owner = await event(client);
    await upload(client, owner, INTENT);

    await expect(client.media.upload({ file: imageFile(), uploadIntentId: INTENT }, owner.treeId))
      .rejects.toMatchObject({ code: 'upload_intent_conflict', retryable: false });
    expect(await count('Media')).toBe(1);
    expect(await count('MediaLink')).toBe(1);
  });

  it('allows a replay of the original target after a later legitimate link is added', async () => {
    const client = new LocalDataClient();
    const owner = await event(client);
    const laterOwner = await event(client);
    const first = await upload(client, owner, INTENT);
    await client.media.linkToOwner(first.Id, 'Events', laterOwner.id, owner.treeId);

    const replay = await upload(client, owner, INTENT);

    expect(replay.Id).toBe(first.Id);
    expect(await count('Media')).toBe(1);
    expect(await count('MediaLink')).toBe(2);
  });

  it('rejects a replay that targets only a later-added owner link', async () => {
    const client = new LocalDataClient();
    const owner = await event(client);
    const laterOwner = await event(client);
    const first = await upload(client, owner, INTENT);
    await client.media.linkToOwner(first.Id, 'Events', laterOwner.id, owner.treeId);

    await expect(upload(client, laterOwner, INTENT))
      .rejects.toMatchObject({ code: 'upload_intent_conflict', retryable: false });
    expect(await count('Media')).toBe(1);
    expect(await count('MediaLink')).toBe(2);
  });

  it('returns an existing replay before checking browser storage capacity', async () => {
    const client = new LocalDataClient();
    const owner = await event(client);
    const first = await upload(client, owner, INTENT);
    const estimate = vi.fn().mockResolvedValue({ quota: 1, usage: 1 });
    vi.stubGlobal('navigator', { storage: { estimate } });

    const replay = await upload(client, owner, INTENT, '<svg xmlns="http://www.w3.org/2000/svg"/>');

    expect(replay.Id).toBe(first.Id);
    expect(estimate).not.toHaveBeenCalled();
  });

  it('does not reuse an intent across tree scopes', async () => {
    const client = new LocalDataClient();
    const firstOwner = await event(client);
    const otherTree = await client.trees.create('Other upload tree');
    const secondOwner = await event(client, otherTree.Id);

    const first = await upload(client, firstOwner, THIRD_INTENT);
    const second = await upload(client, secondOwner, THIRD_INTENT);

    expect(second.Id).not.toBe(first.Id);
    expect(await count('Media')).toBe(2);
    expect((await query(`SELECT "TreeId" FROM "Media" ORDER BY "Id"`)).rows)
      .toEqual([{ TreeId: firstOwner.treeId }, { TreeId: secondOwner.treeId }]);
  });
});
