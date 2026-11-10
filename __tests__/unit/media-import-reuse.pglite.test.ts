import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { __setTestDb, query } from '@/lib/db/connection.pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { truncateAllTables } from '../setup/pglite-truncate';
import { LocalGedcomClient } from '@/lib/data/local/gedcom';
import { __resetLocalUserCache } from '@/lib/data/local-user';
import { importGedcomService } from '@/lib/services/gedcom';
import type { MediaImportMaterializationOutcome } from '@/lib/data/types';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));
vi.mock('@/lib/media/process-image', async () => {
  const actual = await vi.importActual<typeof import('@/lib/media/process-image')>('@/lib/media/process-image');
  return {
    ...actual,
    processForUpload: async (file: File) => ({
      bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type, format: 'JPG', width: 0, height: 0,
    }),
    downscaleToThumb: async () => null,
  };
});
vi.mock('@/lib/services/media-face-capture', () => ({ captureFacesForMedia: async () => ({ captured: 0, caption: null }) }));

const ged = (lines: string[]) => new File([['0 HEAD', ...lines, '0 TRLR'].join('\n')], 'tree.ged', { type: 'text/plain' });
const jpg = (name: string, bytes: string) => new File([bytes], name, { type: 'image/jpeg' });

// Two people; Ann's photo is her primary, and Bob's is the same bytes under another path.
const FAMILY = ged([
  '0 @I1@ INDI', '1 NAME Ann /Lee/', '1 OBJE', '2 FILE media/ann.jpg', '2 FORM jpg', '2 _PRIM Y',
  '0 @I2@ INDI', '1 NAME Bob /Lee/', '1 OBJE', '2 FILE media/copy-of-ann.jpg', '2 FORM jpg',
]);
const ARCHIVE: Record<string, File> = {
  'media/ann.jpg': jpg('ann.jpg', 'ANN-BYTES'),
  'media/copy-of-ann.jpg': jpg('copy-of-ann.jpg', 'ANN-BYTES'),
};

async function importAndMaterialize(file: File, archive: Record<string, File>, mode: 'overwrite' | 'merge') {
  const result = await importGedcomService({ file, mode, currentUserId: 1, requestedTreeId: 1 });
  const client = new LocalGedcomClient();
  const outcomes: MediaImportMaterializationOutcome[] = [];
  for (const item of result.mediaItems) {
    outcomes.push(await client.materializeImportMedia(item.id, item.archivePath, archive[item.archivePath], 1));
  }
  return outcomes;
}

async function counts() {
  const one = async (sql: string) => ((await query(sql)).rows[0] as { n: number }).n;
  return {
    media: await one('SELECT COUNT(*)::int AS n FROM "Media"'),
    blobs: await one('SELECT COUNT(*)::int AS n FROM "MediaBlob"'),
    links: await one('SELECT COUNT(*)::int AS n FROM "MediaLink"'),
    items: await one('SELECT COUNT(*)::int AS n FROM "MediaImportItem"'),
    primaries: await one('SELECT COUNT(*)::int AS n FROM "MediaLink" WHERE "IsPrimary" = 1'),
  };
}

describe('import reuses a photo already in the tree with the same bytes (#858)', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'reuse@example.test', 'local-web')`);
    __resetLocalUserCache();
    await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Reuse')`);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  it('stores duplicate bytes in one batch once, linked to both owners', async () => {
    const outcomes = await importAndMaterialize(FAMILY, ARCHIVE, 'overwrite');
    expect(outcomes.map((o) => o.outcome)).toEqual(['ready', 'ready']);
    expect(outcomes.filter((o) => o.outcome === 'ready' && o.reused)).toHaveLength(1);
    expect(await counts()).toEqual({ media: 1, blobs: 1, links: 2, items: 1, primaries: 2 });
  });

  it('a second merge of the same archive adds no photo, link or file, and keeps the primary', async () => {
    await importAndMaterialize(FAMILY, ARCHIVE, 'overwrite');
    const before = await counts();
    const primaryBefore = (await query('SELECT "MediaId", "OwnerId" FROM "MediaLink" WHERE "IsPrimary" = 1')).rows;

    const outcomes = await importAndMaterialize(FAMILY, ARCHIVE, 'merge');
    expect(outcomes.every((o) => o.outcome === 'ready' && o.reused)).toBe(true);
    expect(await counts()).toEqual(before);
    expect((await query('SELECT "MediaId", "OwnerId" FROM "MediaLink" WHERE "IsPrimary" = 1')).rows).toEqual(primaryBefore);
  });

  it('never merges different bytes, even under the same file name', async () => {
    await importAndMaterialize(FAMILY, ARCHIVE, 'overwrite');
    const other = { 'media/ann.jpg': jpg('ann.jpg', 'DIFFERENT'), 'media/copy-of-ann.jpg': jpg('copy-of-ann.jpg', 'DIFFERENT') };
    const outcomes = await importAndMaterialize(FAMILY, other, 'merge');
    expect(outcomes.filter((o) => o.outcome === 'ready' && o.reused)).toHaveLength(1); // the batch's own duplicate
    expect((await counts()).media).toBe(2);
    expect((await counts()).blobs).toBe(2);
  });

  it('links an existing photo that was uploaded outside any import', async () => {
    const existing = (await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "ContentHash")
       VALUES (1, 1, 'Uploaded earlier', encode(sha256('ANN-BYTES'::bytea), 'hex')) RETURNING "Id"`,
    )).rows[0] as { Id: number };
    await query(`INSERT INTO "MediaBlob" ("MediaId", "Data") VALUES ($1, 'ANN-BYTES'::bytea)`, [existing.Id]);

    const outcomes = await importAndMaterialize(FAMILY, ARCHIVE, 'merge');
    expect(outcomes.map((o) => [o.outcome, o.outcome === 'ready' && o.reused, o.item?.mediaId]))
      .toEqual([['ready', true, existing.Id], ['ready', true, existing.Id]]);
    expect(await counts()).toMatchObject({ media: 1, blobs: 1, links: 2 });
    expect((await query('SELECT "Title" FROM "Media"')).rows).toEqual([{ Title: 'Uploaded earlier' }]);
  });
  // An app upload stores compressed bytes but hashes the original; an export
  // carries the stored bytes, so the hash alone never matches them (#952).
  async function seedUploadedPhoto(stored: string) {
    const row = (await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FileSize", "ContentHash")
       VALUES (1, 1, 'Uploaded in the app', $1, encode(sha256('ORIGINAL-UPLOAD'::bytea), 'hex')) RETURNING "Id"`,
      [stored.length],
    )).rows[0] as { Id: number };
    await query(`INSERT INTO "MediaBlob" ("MediaId", "Data") VALUES ($1, convert_to($2, 'UTF8'))`, [row.Id, stored]);
    return row.Id;
  }

  it('links an app-uploaded photo when the archive holds its stored bytes (#952)', async () => {
    const existing = await seedUploadedPhoto('ANN-BYTES');
    const outcomes = await importAndMaterialize(FAMILY, ARCHIVE, 'merge');
    expect(outcomes.map((o) => [o.outcome, o.outcome === 'ready' && o.reused, o.item?.mediaId]))
      .toEqual([['ready', true, existing], ['ready', true, existing]]);
    expect(await counts()).toMatchObject({ media: 1, blobs: 1, links: 2 });
  });

  it('never matches a stored copy of the same size with different bytes (#952)', async () => {
    await seedUploadedPhoto('ANN-BYTEZ');
    const outcomes = await importAndMaterialize(FAMILY, ARCHIVE, 'merge');
    expect(outcomes.filter((o) => o.outcome === 'ready' && o.reused)).toHaveLength(1); // the batch's own duplicate
    expect(await counts()).toMatchObject({ media: 2, blobs: 2 });
  });
});
