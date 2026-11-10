import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { LocalDataClient } from '@/lib/data/local';
import { processEventMediaDraft, type EventMediaDraftItem } from '@/app/components/media/event-media-draft';
import * as pgliteConnection from '@/lib/db/connection.pglite';
import { __resetLocalUserCache } from '@/lib/data/local-user';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { truncateAllTables } from '../setup/pglite-truncate';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

const TREE_NAME = 'Task 7 event-media flow';
const FAMILY_ID = 42;
const UPLOAD_INTENT_ID = '11111111-1111-4111-8111-111111111111';

function svgFile(name: string, body: string): File {
  return new File([`<svg xmlns="http://www.w3.org/2000/svg"><text>${body}</text></svg>`], name, {
    type: 'image/svg+xml',
  });
}

async function count(table: 'Events' | 'Media' | 'MediaBlob' | 'MediaLink', treeId: number): Promise<number> {
  const result = await pgliteConnection.query(
    table === 'MediaBlob'
      ? `SELECT count(*)::int AS n
           FROM "MediaBlob" b JOIN "Media" m ON m."Id" = b."MediaId"
          WHERE m."TreeId" = $1`
      : table === 'MediaLink'
        ? `SELECT count(*)::int AS n
             FROM "MediaLink" l JOIN "Media" m ON m."Id" = l."MediaId"
            WHERE m."TreeId" = $1`
        : `SELECT count(*)::int AS n FROM "${table}" WHERE "TreeId" = $1`,
    [treeId],
  );
  return (result.rows[0] as { n: number }).n;
}

async function setupTree(client: LocalDataClient): Promise<number> {
  const tree = await client.trees.create(TREE_NAME);
  return tree.Id;
}

describe('new event media attachment flow (local/PGlite)', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    pgliteConnection.__setTestDb(db);
    await pgliteConnection.query('SELECT 1');
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    __resetLocalUserCache();
  });

  afterAll(async () => {
    pgliteConnection.__setTestDb(null);
    await db.close();
  });

  it.each([
    {
      label: 'person',
      createEvent: async (client: LocalDataClient, treeId: number) => {
        const person = await client.people.create({ FirstName: 'Fictional', LastName: 'Person' }, { treeId });
        return client.events.create({
          Type: 'OCCU', Date: '1911', Place: 'Deptford', Description: 'Shipwright', PersonId: person.Id,
        }, treeId);
      },
      assertTarget: (event: { PersonId: number | null; FamilyId: number | null }) => {
        expect(event.PersonId).toBe(1);
        expect(event.FamilyId).toBeNull();
      },
    },
    {
      label: 'family',
      createEvent: async (client: LocalDataClient, treeId: number) => {
        await pgliteConnection.query(
          `INSERT INTO "Families" ("Id", "UserId", "TreeId") VALUES ($1, 1, $2)`,
          [FAMILY_ID, treeId],
        );
        return client.events.create({
          Type: 'DIV', Date: '1984', Place: 'Glasgow', Description: 'Fictional family event', FamilyId: FAMILY_ID,
        }, treeId);
      },
      assertTarget: (event: { PersonId: number | null; FamilyId: number | null }) => {
        expect(event.PersonId).toBeNull();
        expect(event.FamilyId).toBe(FAMILY_ID);
      },
    },
  ])('$label event is created once and exact draft replay is idempotent', async ({ createEvent, assertTarget }) => {
    const client = new LocalDataClient();
    const treeId = await setupTree(client);
    const event = await createEvent(client, treeId);

    expect(event.Id).toBe(1);
    expect(event.TreeId).toBe(treeId);
    assertTarget(event);
    expect(await count('Events', treeId)).toBe(1);

    const existing = await client.media.upload({
      file: svgFile('existing.svg', 'existing'),
      title: 'Existing tree media',
    }, treeId);
    const stagedFile = svgFile('staged.svg', 'staged');
    const draft: EventMediaDraftItem[] = [
      { key: 'existing-media', kind: 'existing', mediaId: existing.Id },
      { key: 'staged-file', kind: 'file', file: stagedFile, uploadIntentId: UPLOAD_INTENT_ID },
    ];

    const first = await processEventMediaDraft({ eventId: event.Id, treeId, items: draft, client: client.media });
    expect(first).toEqual({ succeededKeys: ['existing-media', 'staged-file'], failed: [] });

    const firstUploaded = await pgliteConnection.query(
      `SELECT "Id", "TreeId", "UploadIntentId" FROM "Media" WHERE "UploadIntentId" = $1`,
      [UPLOAD_INTENT_ID],
    );
    expect(firstUploaded.rows).toEqual([{ Id: expect.any(Number), TreeId: treeId, UploadIntentId: UPLOAD_INTENT_ID }]);
    const uploadedMediaId = (firstUploaded.rows[0] as { Id: number }).Id;

    const firstLinks = await pgliteConnection.query(
      `SELECT l."MediaId", l."OwnerTable", l."OwnerId", m."TreeId"
         FROM "MediaLink" l JOIN "Media" m ON m."Id" = l."MediaId"
        WHERE l."OwnerTable" = 'Events' AND l."OwnerId" = $1
        ORDER BY l."MediaId"`,
      [event.Id],
    );
    expect(firstLinks.rows).toEqual([
      { MediaId: existing.Id, OwnerTable: 'Events', OwnerId: event.Id, TreeId: treeId },
      { MediaId: uploadedMediaId, OwnerTable: 'Events', OwnerId: event.Id, TreeId: treeId },
    ]);

    const second = await processEventMediaDraft({ eventId: event.Id, treeId, items: draft, client: client.media });
    expect(second).toEqual(first);

    const replayedUpload = await pgliteConnection.query(
      `SELECT "Id" FROM "Media" WHERE "TreeId" = $1 AND "UploadIntentId" = $2`,
      [treeId, UPLOAD_INTENT_ID],
    );
    expect(replayedUpload.rows).toEqual([{ Id: uploadedMediaId }]);
    expect(await count('Events', treeId)).toBe(1);
    expect(await count('Media', treeId)).toBe(2);
    expect(await count('MediaBlob', treeId)).toBe(2);
    expect(await count('MediaLink', treeId)).toBe(2);

    const persisted = await pgliteConnection.query(
      `SELECT "PersonId", "FamilyId", "TreeId" FROM "Events" WHERE "Id" = $1`,
      [event.Id],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0].TreeId).toBe(treeId);
    assertTarget(persisted.rows[0]);
  });

  it('completes the real local transaction flow without a global query while an upload transaction is held', async () => {
    const client = new LocalDataClient();
    const treeId = await setupTree(client);
    const person = await client.people.create({ FirstName: 'Transaction', LastName: 'Probe' }, { treeId });
    const event = await client.events.create({ Type: 'RESI', PersonId: person.Id }, treeId);

    let transactionDepth = 0;
    let globalQueryInsideTransaction = false;
    const originalDbQuery = db.query.bind(db);
    const dbQuerySpy = vi.spyOn(db, 'query').mockImplementation(async (text, params, options) => {
      const sql = text.trim().toUpperCase();
      if (sql === 'BEGIN') transactionDepth += 1;
      const result = await originalDbQuery(text, params, options);
      if (sql === 'COMMIT' || sql === 'ROLLBACK') transactionDepth = Math.max(0, transactionDepth - 1);
      return result;
    });
    const originalGlobalQuery = pgliteConnection.query;
    const globalQuerySpy = vi.spyOn(pgliteConnection, 'query').mockImplementation(async (text, params) => {
      if (transactionDepth > 0) globalQueryInsideTransaction = true;
      return originalGlobalQuery(text, params);
    });

    try {
      const result = await processEventMediaDraft({
        eventId: event.Id,
        treeId,
        items: [{ key: 'file', kind: 'file', file: svgFile('transaction.svg', 'probe'), uploadIntentId: UPLOAD_INTENT_ID }],
        client: client.media,
      });
      expect(result).toEqual({ succeededKeys: ['file'], failed: [] });
      expect(globalQuerySpy).toHaveBeenCalled();
      expect(globalQueryInsideTransaction).toBe(false);
    } finally {
      globalQuerySpy.mockRestore();
      dbQuerySpy.mockRestore();
    }
  });
});
