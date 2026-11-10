import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { __setTestDb, query } from '@/lib/db/connection.pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema } from '@/lib/db/init-schema';
import { LocalGedcomClient } from '@/lib/data/local/gedcom';
import { __resetLocalUserCache } from '@/lib/data/local-user';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));
const mediaImageMocks = vi.hoisted(() => ({
  processForUpload: vi.fn(),
  downscaleToThumb: vi.fn(),
}));
vi.mock('@/lib/media/process-image', async () => {
  const actual = await vi.importActual<typeof import('@/lib/media/process-image')>('@/lib/media/process-image');
  return {
    ...actual,
    processForUpload: mediaImageMocks.processForUpload,
    downscaleToThumb: mediaImageMocks.downscaleToThumb,
  };
});
vi.mock('@/lib/services/media-face-capture', () => ({
  captureFacesForMedia: async () => {
    const { query: globalQuery } = await import('@/lib/db/connection');
    await globalQuery('SELECT 1');
    return { captured: 0, caption: null };
  },
}));
vi.mock('fs/promises', () => ({
  mkdir: async () => undefined,
  writeFile: async () => undefined,
  unlink: async () => undefined,
}));
vi.mock('sharp', () => ({
  default: () => ({
    rotate() { return this; },
    resize() { return this; },
    jpeg() { return this; },
    toBuffer: async () => Buffer.from('compressed'),
  }),
}));
import { createMediaImportItem } from '@/lib/db/queries/media-import-items';
import {
  listUnresolvedImportMediaService,
  markImportMediaMissingService,
  removeUnresolvedImportMediaService,
  removeUnresolvedImportMediaBatchService,
} from '@/lib/services/media-import-items';

afterEach(() => { vi.unstubAllGlobals(); });

let db: PGlite;
let pendingMediaId = 0;
let readyMediaId = 0;

describe('media import recovery state', () => {
  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await initializeSchema({ query: (text, params) => db.query(text, params as unknown[]) });
    await query('SELECT 1');
  });

  beforeEach(async () => {
    await query(`TRUNCATE "AuditLog", "MediaImportItem", "MediaLink", "MediaBlob", "MediaThumb", "Media", "Trees", "Users" RESTART IDENTITY CASCADE`);
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'recovery@example.test', 'local-web')`);
    __resetLocalUserCache();
    await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Recovery')`);
    const mediaRows = await query(`INSERT INTO "Media" ("UserId", "TreeId", "Title") VALUES (1, 1, 'pending'), (1, 1, 'ready') RETURNING "Id"`);
    pendingMediaId = (mediaRows.rows[0] as { Id: number }).Id;
    readyMediaId = (mediaRows.rows[1] as { Id: number }).Id;
    const executor = { query: (text: string, params?: unknown[]) => db.query(text, params) };
    await createMediaImportItem({
      importId: 'import-1', documentMediaId: '@M1@', treeId: 1, mediaId: pendingMediaId,
      archivePath: 'media/M1/photo.jpg', originalFilename: 'photo.jpg',
    }, executor);
    await createMediaImportItem({
      importId: 'import-1', documentMediaId: '@M2@', treeId: 1, mediaId: readyMediaId,
      archivePath: 'media/M2/ready.jpg', originalFilename: 'ready.jpg', status: 'ready',
    }, executor);
    mediaImageMocks.processForUpload.mockImplementation(async (file: File) => ({
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type,
      format: file.type === 'image/svg+xml' ? 'SVG' : 'JPG',
      width: 0,
      height: 0,
    }));
    mediaImageMocks.downscaleToThumb.mockResolvedValue(null);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  it('lists unresolved items, marks pending items missing, and preserves ready state', async () => {
    expect((await listUnresolvedImportMediaService({ requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1 })).map((item) => item.id)).toEqual([1]);
    const result = await markImportMediaMissingService({
      requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1, itemIds: [1],
    });
    expect(result[0]).toMatchObject({ status: 'missing', failureCode: 'archive_file_missing' });
    expect((await query(`SELECT "Status", "FailureCode" FROM "MediaImportItem" ORDER BY "Id"`)).rows).toEqual([
      { Status: 'missing', FailureCode: 'archive_file_missing' },
      { Status: 'ready', FailureCode: null },
    ]);
  });

  it('enforces the missing batch cap through the shared local service', async () => {
    await expect(markImportMediaMissingService({
      requestedTreeId: 1,
      requestedOwnerId: null,
      currentUserId: 1,
      itemIds: Array.from({ length: 101 }, (_, index) => index + 1),
    })).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('removes the unresolved media row and all cascading import state', async () => {
    await removeUnresolvedImportMediaService({ requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1, itemId: 1 });
    expect((await query(`SELECT COUNT(*)::int AS count FROM "Media" WHERE "Id" = $1`, [pendingMediaId])).rows[0].count).toBe(0);
    expect((await query(`SELECT COUNT(*)::int AS count FROM "MediaImportItem" WHERE "Id" = 1`)).rows[0].count).toBe(0);
  });

  it('materializes an SVG once and returns already_ready on a repeated retry', async () => {
    const client = new LocalGedcomClient();
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'photo.svg', { type: 'image/svg+xml' });
    const first = await client.materializeImportMedia(1, 'wrong/photo.jpg', file, 1);
    // The stored identity is authoritative: a corrected archive path must be
    // selected for the next attempt, even when the browser file name differs.
    expect(first.outcome).toBe('failed');
    expect((await query(`SELECT "Status", "FailureCode" FROM "MediaImportItem" WHERE "Id" = 1`)).rows).toEqual([
      { Status: 'failed', FailureCode: 'archive_path_mismatch' },
    ]);
    expect((await query(`SELECT COUNT(*)::int AS count FROM "MediaBlob" WHERE "MediaId" = $1`, [pendingMediaId])).rows[0].count).toBe(0);
    const corrected = await client.materializeImportMedia(1, 'media/M1/photo.jpg', new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' }), 1);
    expect(corrected.outcome).toBe('ready');
    const repeat = await client.materializeImportMedia(1, 'media/M1/photo.jpg', new File(['not-decoded'], 'photo.svg', { type: 'image/svg+xml' }), 1);
    expect(repeat.outcome).toBe('already_ready');
    expect((await query(`SELECT COUNT(*)::int AS count FROM "MediaBlob" WHERE "MediaId" = $1`, [pendingMediaId])).rows[0].count).toBe(1);
    expect((await query(`SELECT COUNT(*)::int AS count FROM "MediaThumb" WHERE "MediaId" = $1`, [pendingMediaId])).rows[0].count).toBe(0);
  });

  it('awaits and stores a generated 256px thumbnail for raster recovery', async () => {
    const client = new LocalGedcomClient();
    const processedBytes = new Uint8Array([1, 2, 3]);
    const thumbnailBytes = new Uint8Array([8, 9]);
    mediaImageMocks.processForUpload.mockResolvedValueOnce({
      bytes: processedBytes,
      contentType: 'image/jpeg',
      format: 'JPG',
      width: 640,
      height: 480,
    });
    mediaImageMocks.downscaleToThumb.mockResolvedValueOnce({ bytes: thumbnailBytes, contentType: 'image/jpeg' });

    const result = await client.materializeImportMedia(
      1,
      'media/M1/photo.jpg',
      new File(['source'], 'photo.jpg', { type: 'image/jpeg' }),
      1,
    );

    expect(result.outcome).toBe('ready');
    expect(mediaImageMocks.downscaleToThumb).toHaveBeenCalledWith(processedBytes, 'image/jpeg', 256);
    expect((await query(`SELECT "Data" FROM "MediaBlob" WHERE "MediaId" = $1`, [pendingMediaId])).rows)
      .toEqual([{ Data: processedBytes }]);
    expect((await query(`SELECT "Data" FROM "MediaThumb" WHERE "MediaId" = $1`, [pendingMediaId])).rows)
      .toEqual([{ Data: thumbnailBytes }]);
  });

  it('keeps the ready full blob when only thumbnail storage fails', async () => {
    const client = new LocalGedcomClient();
    const processedBytes = new Uint8Array([4, 5, 6]);
    mediaImageMocks.processForUpload.mockResolvedValueOnce({
      bytes: processedBytes,
      contentType: 'image/jpeg',
      format: 'JPG',
      width: 640,
      height: 480,
    });
    mediaImageMocks.downscaleToThumb.mockResolvedValueOnce({ bytes: new Uint8Array([7, 8]), contentType: 'image/jpeg' });
    const originalQuery = db.query.bind(db);
    const quotaError = Object.assign(new Error('browser quota details'), { name: 'QuotaExceededError' });
    const querySpy = vi.spyOn(db, 'query').mockImplementation(async (text, params) => {
      if (typeof text === 'string' && text.includes('INSERT INTO "MediaThumb"')) throw quotaError;
      return originalQuery(text, params as unknown[]);
    });

    const result = await client.materializeImportMedia(
      1,
      'media/M1/photo.jpg',
      new File(['source'], 'photo.jpg', { type: 'image/jpeg' }),
      1,
    );

    expect(result.outcome).toBe('ready');
    expect((await query(`SELECT "Data" FROM "MediaBlob" WHERE "MediaId" = $1`, [pendingMediaId])).rows)
      .toEqual([{ Data: processedBytes }]);
    expect((await query(`SELECT COUNT(*)::int AS count FROM "MediaThumb" WHERE "MediaId" = $1`, [pendingMediaId])).rows[0].count)
      .toBe(0);
    querySpy.mockRestore();
  });

  it('records storage capacity failure before processing when the browser estimate is insufficient', async () => {
    const client = new LocalGedcomClient();
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'photo.svg', { type: 'image/svg+xml' });
    const arrayBuffer = vi.spyOn(file, 'arrayBuffer');
    const estimate = vi.fn().mockResolvedValue({ quota: file.size - 1, usage: 0 });
    vi.stubGlobal('navigator', { storage: { estimate } });

    const result = await client.materializeImportMedia(1, 'media/M1/photo.jpg', file, 1);

    expect(result).toMatchObject({ outcome: 'failed', failureCode: 'storage_capacity' });
    expect(result.item).toMatchObject({ status: 'failed', failureCode: 'storage_capacity' });
    expect(estimate).toHaveBeenCalledOnce();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect((await query(`SELECT COUNT(*)::int AS count FROM "MediaBlob" WHERE "MediaId" = $1`, [pendingMediaId])).rows[0].count).toBe(0);
  });

  it('continues recovery when the browser estimate is unavailable', async () => {
    const client = new LocalGedcomClient();
    const estimate = vi.fn().mockRejectedValue(new Error('estimate unavailable'));
    vi.stubGlobal('navigator', { storage: { estimate } });
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'photo.svg', { type: 'image/svg+xml' });

    await expect(client.materializeImportMedia(1, 'media/M1/photo.jpg', file, 1))
      .resolves.toMatchObject({ outcome: 'ready', failureCode: null });
    expect(estimate).toHaveBeenCalledOnce();
  });

  it('classifies a write-time browser quota exception as storage capacity', async () => {
    const client = new LocalGedcomClient();
    const originalQuery = db.query.bind(db);
    const quotaError = Object.assign(new Error('browser quota details'), { name: 'QuotaExceededError' });
    const querySpy = vi.spyOn(db, 'query').mockImplementation(async (text, params) => {
      if (typeof text === 'string' && text.includes('INSERT INTO "MediaBlob"')) throw quotaError;
      return originalQuery(text, params as unknown[]);
    });
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'photo.svg', { type: 'image/svg+xml' });

    const result = await client.materializeImportMedia(1, 'media/M1/photo.jpg', file, 1);

    expect(result).toMatchObject({ outcome: 'failed', failureCode: 'storage_capacity' });
    expect(result.item).toMatchObject({ status: 'failed', failureCode: 'storage_capacity' });
    querySpy.mockRestore();
  });

  it('returns a null item and leaves recovery pending when capacity failure cannot be recorded', async () => {
    const client = new LocalGedcomClient();
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'photo.svg', { type: 'image/svg+xml' });
    vi.stubGlobal('navigator', { storage: { estimate: vi.fn().mockResolvedValue({ quota: file.size - 1, usage: 0 }) } });
    const originalQuery = db.query.bind(db);
    const quotaError = Object.assign(new Error('browser quota details'), { name: 'QuotaExceededError' });
    const querySpy = vi.spyOn(db, 'query').mockImplementation(async (text, params) => {
      if (typeof text === 'string' && text.includes('UPDATE "MediaImportItem"')) throw quotaError;
      return originalQuery(text, params as unknown[]);
    });

    const result = await client.materializeImportMedia(1, 'media/M1/photo.jpg', file, 1);

    expect(result).toEqual({ outcome: 'failed', item: null, failureCode: 'storage_capacity', retryable: true });
    expect((await query(`SELECT "Status", "FailureCode" FROM "MediaImportItem" WHERE "Id" = 1`)).rows)
      .toEqual([{ Status: 'pending', FailureCode: null }]);
    querySpy.mockRestore();
  });

  it('coalesces concurrent retries into one ready item and one blob', async () => {
    const client = new LocalGedcomClient();
    const makeFile = () => new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'photo.svg', { type: 'image/svg+xml' });
    const outcomes = await Promise.all([
      client.materializeImportMedia(1, 'media/M1/photo.jpg', makeFile(), 1),
      client.materializeImportMedia(1, 'media/M1/photo.jpg', makeFile(), 1),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual(['already_ready', 'ready']);
    expect((await query(`SELECT COUNT(*)::int AS count FROM "MediaImportItem" WHERE "Id" = 1 AND "Status" = 'ready'`)).rows[0].count).toBe(1);
    expect((await query(`SELECT COUNT(*)::int AS count FROM "Media" WHERE "Id" = $1`, [pendingMediaId])).rows[0].count).toBe(1);
    expect((await query(`SELECT COUNT(*)::int AS count FROM "MediaBlob" WHERE "MediaId" = $1`, [pendingMediaId])).rows[0].count).toBe(1);
    expect((await query(`SELECT COUNT(*)::int AS count FROM "MediaLink" WHERE "MediaId" = $1`, [pendingMediaId])).rows[0].count).toBe(0);
  });

  it('maps inaccessible materialization and deletion scopes to not found', async () => {
    const { materializeImportMediaService } = await import('@/lib/services/media-upload');
    const { removeUnresolvedImportMediaService } = await import('@/lib/services/media-import-items');
    const file = new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' });

    await expect(materializeImportMediaService({
      itemId: 1, archivePath: 'media/M1/photo.jpg', file,
      requestedTreeId: 999999, requestedOwnerId: null, currentUserId: 1,
    })).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(removeUnresolvedImportMediaService({
      itemId: 1, requestedTreeId: 999999, requestedOwnerId: null, currentUserId: 1,
    })).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('keeps an authorized view-only tree forbidden for materialize and delete', async () => {
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (2, 'owner@example.test', 'owner-web')`);
    await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (2, 2, 'Owner tree')`);
    await query(`INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "TreeId", "Permission") VALUES (2, 1, 2, 'view')`);
    const media = await query(`INSERT INTO "Media" ("UserId", "TreeId", "Title") VALUES (2, 2, 'view-only') RETURNING "Id"`);
    await createMediaImportItem({
      importId: 'view-import', documentMediaId: '@VIEW@', treeId: 2,
      mediaId: (media.rows[0] as { Id: number }).Id,
      archivePath: 'media/VIEW/photo.jpg', originalFilename: 'photo.jpg',
    }, { query: (text, params) => db.query(text, params) });
    const { materializeImportMediaService } = await import('@/lib/services/media-upload');
    const { removeUnresolvedImportMediaService } = await import('@/lib/services/media-import-items');
    const file = new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' });

    await expect(materializeImportMediaService({
      itemId: 2, archivePath: 'media/VIEW/photo.jpg', file,
      requestedTreeId: 2, requestedOwnerId: null, currentUserId: 1,
    })).rejects.toMatchObject({ name: 'AccessError' });
    await expect(removeUnresolvedImportMediaService({
      itemId: 2, requestedTreeId: 2, requestedOwnerId: null, currentUserId: 1,
    })).rejects.toMatchObject({ name: 'AccessError' });
  });

  describe('bulk remove (#859)', () => {
    async function seedGroup(importId: string, count: number, status: 'pending' | 'failed' = 'failed'): Promise<number[]> {
      const executor = { query: (text: string, params?: unknown[]) => db.query(text, params) };
      const ids: number[] = [];
      for (let i = 0; i < count; i++) {
        const media = await query(`INSERT INTO "Media" ("UserId", "TreeId", "Title") VALUES (1, 1, $1) RETURNING "Id"`, [`${importId}-${i}`]);
        const item = await createMediaImportItem({
          importId, documentMediaId: `@${importId}-${i}@`, treeId: 1, mediaId: (media.rows[0] as { Id: number }).Id,
          archivePath: `media/${importId}/${i}.jpg`, originalFilename: `${i}.jpg`, status,
          // An abandoned import stopped by a full volume, as on dev (#859).
          failureCode: status === 'failed' ? 'storage_capacity' : null,
        }, executor);
        ids.push(item.id);
      }
      return ids;
    }

    it('removes an abandoned group in one call, audits each row, and leaves ready items and other groups alone', async () => {
      const abandoned = await seedGroup('abandoned', 3);
      const other = await seedGroup('other', 1, 'pending');

      // The ready item (id 2) rides along, as a stale list would send it.
      const removed = await removeUnresolvedImportMediaBatchService({
        requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1, itemIds: [...abandoned, 2],
      });

      expect(removed).toEqual(abandoned);
      const left = (await query(`SELECT "Id" FROM "MediaImportItem" ORDER BY "Id"`)).rows.map((row) => (row as { Id: number }).Id);
      expect(left).toEqual([1, 2, ...other]);
      expect((await query(`SELECT COUNT(*)::int AS count FROM "Media" WHERE "Id" = $1`, [readyMediaId])).rows[0].count).toBe(1);
      const audits = await query(`SELECT COUNT(*)::int AS count FROM "AuditLog" WHERE "Action" = 'delete' AND "EntityType" = 'media'`);
      expect(audits.rows[0].count).toBe(3);
    });

    it('skips items already gone instead of failing the batch', async () => {
      const [first, second] = await seedGroup('stale', 2);
      await removeUnresolvedImportMediaService({ requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1, itemId: first });
      const removed = await removeUnresolvedImportMediaBatchService({
        requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1, itemIds: [first, second],
      });
      expect(removed).toEqual([second]);
    });

    it('enforces the shared batch cap', async () => {
      await expect(removeUnresolvedImportMediaBatchService({
        requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1,
        itemIds: Array.from({ length: 101 }, (_, index) => index + 1),
      })).rejects.toMatchObject({ name: 'ValidationError' });
    });

    it.each(['view', 'contribute'])('forbids a %s user and removes nothing', async (permission) => {
      await query(`DELETE FROM "TreeSharing"`);
      await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (2, 'owner@example.test', 'owner-web')`);
      await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (2, 2, 'Owner tree')`);
      await query(`INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "TreeId", "Permission") VALUES (2, 1, 2, $1)`, [permission]);
      const media = await query(`INSERT INTO "Media" ("UserId", "TreeId", "Title") VALUES (2, 2, 'shared') RETURNING "Id"`);
      const item = await createMediaImportItem({
        importId: 'shared-import', documentMediaId: '@S@', treeId: 2, mediaId: (media.rows[0] as { Id: number }).Id,
        archivePath: 'media/S/photo.jpg', originalFilename: 'photo.jpg',
      }, { query: (text, params) => db.query(text, params) });

      await expect(removeUnresolvedImportMediaBatchService({
        requestedTreeId: 2, requestedOwnerId: null, currentUserId: 1, itemIds: [item.id],
      })).rejects.toMatchObject({ name: 'AccessError' });
      expect((await query(`SELECT COUNT(*)::int AS count FROM "MediaImportItem" WHERE "Id" = $1`, [item.id])).rows[0].count).toBe(1);
    });
  });
});
