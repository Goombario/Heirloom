import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { query } from '@/lib/db/connection';
import { createMediaImportItem } from '@/lib/db/queries/media-import-items';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { exportGedcomService } from '@/lib/services/gedcom-export';
import {
  materializeImportMediaService,
  type MaterializeImportMediaParams,
  uploadMediaService,
} from '@/lib/services/media-upload';
import {
  listUnresolvedImportMediaService,
  removeUnresolvedImportMediaService,
  removeUnresolvedImportMediaBatchService,
} from '@/lib/services/media-import-items';
import { getOrCreateThumbnail } from '@/lib/media-thumbnail';
import { normalizeArchivePath } from '@/lib/gedcom/media-match';
import { cleanupTestData, hasTestDatabase } from '../setup/db-helpers';
import { TEST_USER } from '../setup/test-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;
const DATA_DIR_PREFIX = 'media-import-recovery-hosted-';

describeIf('hosted media import recovery', () => {
  let dataDir: string | null = null;
  const previousDataDir = process.env.DATA_DIR;

  beforeEach(async () => {
    await cleanupTestData();
    dataDir = await mkdtemp(path.join(os.tmpdir(), DATA_DIR_PREFIX));
    process.env.DATA_DIR = dataDir;
  });

  afterEach(async () => {
    try {
      await cleanupTestData();
    } finally {
      const removable = dataDir;
      dataDir = null;
      if (removable !== null) {
        const resolved = path.resolve(removable);
        const tempRoot = path.resolve(os.tmpdir());
        if (
          !path.isAbsolute(resolved)
          || path.dirname(resolved) !== tempRoot
          || !path.basename(resolved).startsWith(DATA_DIR_PREFIX)
        ) {
          throw new Error('Refusing to remove a non-mkdtemp hosted media directory');
        }
        await rm(resolved, { recursive: true, force: true });
      }
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
    }
  });

  async function seedPerson(treeId: number): Promise<number> {
    const result = await query(
      `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName")
       VALUES ($1, $2, 'HostedRecovery', 'Fixture') RETURNING "Id"`,
      [TEST_USER.id, treeId],
    );
    return (result.rows[0] as { Id: number }).Id;
  }

  async function seedImportItem(
    treeId: number,
    personId: number,
    documentMediaId: string,
    archivePath: string,
  ) {
    const mediaResult = await query(
      `INSERT INTO "Media"
         ("UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FileSize", "ContentHash")
       VALUES ($1, $2, $3, NULL, 'SVG', 'image/svg+xml', 0, NULL)
       RETURNING "Id"`,
      [TEST_USER.id, treeId, `Hosted recovery ${documentMediaId}`],
    );
    const mediaId = (mediaResult.rows[0] as { Id: number }).Id;
    await query(
      `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary")
       VALUES ($1, 'People', $2, $3)`,
      [mediaId, personId, documentMediaId === '@O1@' ? 1 : 0],
    );
    const item = await createMediaImportItem({
      importId: 'hosted-recovery-fixture',
      documentMediaId,
      treeId,
      mediaId,
      archivePath,
      originalFilename: 'synthetic.svg',
    });
    return { item, mediaId };
  }

  function materializeParams(
    treeId: number,
    itemId: number,
    archivePath: string,
    bytes: Uint8Array,
  ): MaterializeImportMediaParams {
    return {
      itemId,
      archivePath,
      file: new File([new Uint8Array(bytes) as unknown as BlobPart], 'synthetic.svg', { type: 'image/svg+xml' }),
      requestedTreeId: treeId,
      requestedOwnerId: null,
      currentUserId: TEST_USER.id,
    };
  }

  it('bulk-removes an abandoned group with its links, items and audit rows, skipping ids already gone (#859)', async () => {
    const treeId = await resolveDefaultTree(TEST_USER.id);
    const personId = await seedPerson(treeId);
    const first = await seedImportItem(treeId, personId, '@B1@', 'media/@B1@/one.svg');
    const second = await seedImportItem(treeId, personId, '@B2@', 'media/@B2@/two.svg');

    const removed = await removeUnresolvedImportMediaBatchService({
      itemIds: [first.item.id, second.item.id, second.item.id + 1000],
      requestedTreeId: treeId,
      requestedOwnerId: null,
      currentUserId: TEST_USER.id,
    });

    expect(removed).toEqual([first.item.id, second.item.id]);
    const rows = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM "Media" WHERE "Id" = ANY($1)) AS "media",
         (SELECT COUNT(*)::int FROM "MediaLink" WHERE "MediaId" = ANY($1)) AS "links",
         (SELECT COUNT(*)::int FROM "MediaImportItem" WHERE "Id" = ANY($2)) AS "items",
         (SELECT COUNT(*)::int FROM "AuditLog" WHERE "EntityType" = 'media' AND "Action" = 'delete' AND "EntityId" = ANY($1)) AS "audits"`,
      [[first.mediaId, second.mediaId], [first.item.id, second.item.id]],
    );
    expect(rows.rows[0]).toEqual({ media: 0, links: 0, items: 0, audits: 2 });
  });

  it('reuses an existing hosted photo with the same bytes instead of writing a second file (#858)', async () => {
    const treeId = await resolveDefaultTree(TEST_USER.id);
    const personId = await seedPerson(treeId);
    const otherPersonId = await seedPerson(treeId);
    const first = await seedImportItem(treeId, personId, '@O1@', 'media/@O1@/synthetic.svg');
    const second = await seedImportItem(treeId, otherPersonId, '@O2@', 'media/@O2@/synthetic.svg');
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="3"/>');

    const stored = await materializeImportMediaService(materializeParams(treeId, first.item.id, first.item.archivePath, svgBytes));
    const reused = await materializeImportMediaService(materializeParams(treeId, second.item.id, second.item.archivePath, svgBytes));

    expect(stored).toMatchObject({ outcome: 'ready' });
    expect(stored).not.toHaveProperty('reused');
    expect(reused).toMatchObject({ outcome: 'ready', reused: true, item: { mediaId: first.mediaId, status: 'ready' } });
    const media = await query('SELECT "Id" FROM "Media" WHERE "TreeId" = $1', [treeId]);
    expect(media.rows).toEqual([{ Id: first.mediaId }]);
    const links = await query(
      'SELECT "OwnerId" FROM "MediaLink" WHERE "MediaId" = $1 ORDER BY "OwnerId"',
      [first.mediaId],
    );
    expect(links.rows).toEqual([{ OwnerId: personId }, { OwnerId: otherPersonId }]);
    const items = await query('SELECT "Id" FROM "MediaImportItem" WHERE "TreeId" = $1', [treeId]);
    expect(items.rows).toEqual([{ Id: first.item.id }]);
    expect(await readdir(path.join(dataDir!, 'uploads', String(TEST_USER.id), 'media'))).toHaveLength(1);
  });

  it('reuses an app-uploaded photo when the archive holds its stored file, not the original (#952)', async () => {
    const treeId = await resolveDefaultTree(TEST_USER.id);
    const personId = await seedPerson(treeId);
    const storedBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
    const uploadsDir = path.join(dataDir!, 'uploads', String(TEST_USER.id), 'media');
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, 'uploaded.svg'), storedBytes);
    // The upload hashed its original bytes, which the stored file no longer matches.
    const existing = await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FileSize", "ContentHash")
       VALUES ($1, $2, 'Uploaded in the app', 'uploaded.svg', 'SVG', 'image/svg+xml', $3, $4) RETURNING "Id"`,
      [TEST_USER.id, treeId, storedBytes.length, createHash('sha256').update('original upload').digest('hex')],
    );
    const existingId = (existing.rows[0] as { Id: number }).Id;
    const sameSize = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5"/>');
    const imported = await seedImportItem(treeId, personId, '@O1@', 'media/@O1@/synthetic.svg');
    const different = await seedImportItem(treeId, personId, '@O2@', 'media/@O2@/synthetic.svg');

    const reused = await materializeImportMediaService(materializeParams(treeId, imported.item.id, imported.item.archivePath, storedBytes));
    const stored = await materializeImportMediaService(materializeParams(treeId, different.item.id, different.item.archivePath, sameSize));

    expect(reused).toMatchObject({ outcome: 'ready', reused: true, item: { mediaId: existingId } });
    expect(stored).toMatchObject({ outcome: 'ready', item: { mediaId: different.mediaId } });
    expect(stored).not.toHaveProperty('reused');
    const media = await query('SELECT "Id" FROM "Media" WHERE "TreeId" = $1 ORDER BY "Id"', [treeId]);
    expect(media.rows).toEqual([{ Id: existingId }, { Id: different.mediaId }]);
    expect(await readdir(uploadsDir)).toHaveLength(2);
  });

  it('recovers one hosted file idempotently and exports a complete canonical bundle', async () => {
    const treeId = await resolveDefaultTree(TEST_USER.id);
    const personId = await seedPerson(treeId);
    const archivePath = normalizeArchivePath('./media\\@O1@\\synthetic.svg');
    expect(archivePath).toBe('media/@O1@/synthetic.svg');
    if (archivePath === null) throw new Error('fixture archive path unexpectedly invalid');

    const { item, mediaId } = await seedImportItem(treeId, personId, '@O1@', archivePath);
    const listed = await listUnresolvedImportMediaService({
      requestedTreeId: treeId,
      requestedOwnerId: null,
      currentUserId: TEST_USER.id,
    });
    expect(listed).toEqual([item]);

    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>');
    const firstParams = () => materializeParams(treeId, item.id, archivePath, svgBytes);
    const concurrent = await Promise.all([
      materializeImportMediaService(firstParams()),
      materializeImportMediaService(firstParams()),
    ]);
    const repeated = await materializeImportMediaService(firstParams());

    expect(concurrent.map((outcome) => outcome.outcome).sort()).toEqual(['already_ready', 'ready']);
    expect(repeated.outcome).toBe('already_ready');
    expect(concurrent.every((outcome) => outcome.failureCode === null)).toBe(true);
    expect(repeated.failureCode).toBeNull();

    const itemRow = await query(
      `SELECT "Status", "FailureCode", "ArchivePath", "MediaId"
       FROM "MediaImportItem" WHERE "Id" = $1 AND "TreeId" = $2`,
      [item.id, treeId],
    );
    expect(itemRow.rows).toEqual([{
      Status: 'ready', FailureCode: null, ArchivePath: archivePath, MediaId: mediaId,
    }]);

    const mediaCount = await query('SELECT COUNT(*) AS "count" FROM "Media" WHERE "TreeId" = $1', [treeId]);
    const linkCount = await query(
      `SELECT COUNT(*) AS "count" FROM "MediaLink" WHERE "MediaId" = $1 AND "OwnerTable" = 'People' AND "OwnerId" = $2`,
      [mediaId, personId],
    );
    const importCount = await query('SELECT COUNT(*) AS "count" FROM "MediaImportItem" WHERE "TreeId" = $1', [treeId]);
    const blobCount = await query('SELECT COUNT(*) AS "count" FROM "MediaBlob" WHERE "MediaId" = $1', [mediaId]);
    expect(mediaCount.rows[0]).toEqual({ count: 1 });
    expect(linkCount.rows[0]).toEqual({ count: 1 });
    expect(importCount.rows[0]).toEqual({ count: 1 });
    expect(blobCount.rows[0]).toEqual({ count: 0 });

    const mediaDir = path.join(dataDir!, 'uploads', String(TEST_USER.id), 'media');
    const hostedFiles = await readdir(mediaDir);
    expect(hostedFiles).toHaveLength(1);
    expect(new Uint8Array(await readFile(path.join(mediaDir, hostedFiles[0])))).toEqual(svgBytes);

    const unresolved = await seedImportItem(treeId, personId, '@O2@', 'media/@O2@/unresolved.svg');
    await removeUnresolvedImportMediaService({
      itemId: unresolved.item.id,
      requestedTreeId: treeId,
      requestedOwnerId: null,
      currentUserId: TEST_USER.id,
    });
    const removedRows = await query(
      `SELECT
         (SELECT COUNT(*) FROM "Media" WHERE "Id" = $1) AS "media",
         (SELECT COUNT(*) FROM "MediaLink" WHERE "MediaId" = $1) AS "links",
         (SELECT COUNT(*) FROM "MediaImportItem" WHERE "Id" = $2) AS "items"`,
      [unresolved.mediaId, unresolved.item.id],
    );
    expect(removedRows.rows[0]).toEqual({ media: 0, links: 0, items: 0 });
    expect(await readdir(mediaDir)).toHaveLength(1);

    const preflightResult = await exportGedcomService({
      requestedTreeId: treeId,
      requestedOwnerId: null,
      currentUserId: TEST_USER.id,
      includeMedia: true,
      preflightOnly: true,
    });
    expect(preflightResult).toEqual(expect.objectContaining({
      kind: 'preflight',
      preflight: expect.objectContaining({
        canExport: true,
        omittedTotal: 0,
        byReason: {
          pending: 0, missing: 0, failed: 0, backing_missing: 0, legacy_materialization_unknown: 0,
        },
      }),
    }));

    const exportResult = await exportGedcomService({
      requestedTreeId: treeId,
      requestedOwnerId: null,
      currentUserId: TEST_USER.id,
      includeMedia: true,
    });
    expect(exportResult.kind).toBe('zip');
    if (exportResult.kind !== 'zip') throw new Error('expected hosted media ZIP export');

    const zip = await JSZip.loadAsync(exportResult.buffer);
    const gedcom = (await zip.file('family_tree.ged')!.async('string')).replace(/^\uFEFF/, '');
    const topLevelObje = [...gedcom.matchAll(/^0 (@O\d+@) OBJE$/gm)].map((match) => match[1]);
    const pointerObje = [...gedcom.matchAll(/^\d+ OBJE (@O\d+@)$/gm)].map((match) => match[1]);
    expect(topLevelObje).toEqual(['@O1@']);
    expect(pointerObje).toEqual(topLevelObje);

    const gedcomFilePaths = [...gedcom.matchAll(/^\d+ FILE (.+)$/gm)].map((match) => match[1]);
    // Named from the photo's title, not the recovered file on disk (#802).
    expect(gedcomFilePaths).toEqual(['media/O1-hosted-recovery-o1.svg']);
    expect(hostedFiles).toHaveLength(1);
    for (const filePath of gedcomFilePaths) {
      const entries = Object.keys(zip.files).filter((name) => name === filePath && !zip.files[name].dir);
      expect(entries).toHaveLength(1);
      expect(await zip.file(filePath)!.async('uint8array')).toEqual(svgBytes);
    }
  });

  it('primes a real raster cache that remains readable after the imported original is unavailable', async () => {
    const treeId = await resolveDefaultTree(TEST_USER.id);
    const personId = await seedPerson(treeId);
    const archivePath = 'media/@O3@/synthetic.jpg';
    const { item } = await seedImportItem(treeId, personId, '@O3@', archivePath);
    const rasterBytes = await sharp(Buffer.alloc(512 * 384 * 3, 127), {
      raw: { width: 512, height: 384, channels: 3 },
    }).jpeg({ quality: 90 }).toBuffer();
    const outcome = await materializeImportMediaService({
      itemId: item.id,
      archivePath,
      file: new File([new Uint8Array(rasterBytes) as unknown as BlobPart], 'synthetic.jpg', { type: 'image/jpeg' }),
      requestedTreeId: treeId,
      requestedOwnerId: null,
      currentUserId: TEST_USER.id,
    });
    expect(outcome.outcome).toBe('ready');

    const mediaRow = await query(
      'SELECT "FilePath", "ContentType" FROM "Media" WHERE "Id" = $1 AND "TreeId" = $2',
      [item.mediaId, treeId],
    );
    const media = mediaRow.rows[0] as { FilePath: string; ContentType: string };
    expect(media.FilePath).toMatch(/^imported_.*\.jpg$/);
    expect(media.ContentType).toBe('image/jpeg');
    const originalPath = path.join(dataDir!, 'uploads', String(TEST_USER.id), 'media', media.FilePath);
    const cachedPath = path.join(
      dataDir!, 'uploads', String(TEST_USER.id), 'media', '.thumbs',
      `${createHash('sha256').update(media.FilePath, 'utf8').digest('hex')}_256.jpg`,
    );
    const cachedBytes = await readFile(cachedPath);
    expect(cachedBytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

    await rename(originalPath, `${originalPath}.unavailable`);
    const served = await getOrCreateThumbnail({
      originalPath,
      userId: TEST_USER.id,
      filename: media.FilePath,
      size: 256,
      contentType: media.ContentType,
    });
    expect(served.contentType).toBe('image/jpeg');
    expect(served.buffer).toEqual(cachedBytes);
  });

  it('primes an interactive raster upload cache that remains readable after the original is unavailable', async () => {
    const treeId = await resolveDefaultTree(TEST_USER.id);
    const personId = await seedPerson(treeId);
    const rasterBytes = await sharp(Buffer.alloc(512 * 384 * 3, 91), {
      raw: { width: 512, height: 384, channels: 3 },
    }).jpeg({ quality: 90 }).toBuffer();
    const media = await uploadMediaService({
      file: new File([new Uint8Array(rasterBytes) as unknown as BlobPart], 'interactive.jpg', { type: 'image/jpeg' }),
      title: 'Synthetic interactive raster',
      isPrimary: false,
      personId,
      caseId: null,
      ownerTable: null,
      ownerRecordId: null,
      requestedTreeId: treeId,
      requestedOwnerId: null,
      currentUserId: TEST_USER.id,
    });
    expect(media.FilePath).toMatch(/^\d+_.*\.jpg$/);
    expect(media.ContentType).toBe('image/jpeg');
    const originalPath = path.join(dataDir!, 'uploads', String(TEST_USER.id), 'media', media.FilePath!);
    const cachedPath = path.join(
      dataDir!, 'uploads', String(TEST_USER.id), 'media', '.thumbs',
      `${createHash('sha256').update(media.FilePath!, 'utf8').digest('hex')}_256.jpg`,
    );
    const cachedBytes = await readFile(cachedPath);
    expect(cachedBytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

    await rename(originalPath, `${originalPath}.unavailable`);
    const served = await getOrCreateThumbnail({
      originalPath,
      userId: TEST_USER.id,
      filename: media.FilePath!,
      size: 256,
      contentType: media.ContentType!,
    });
    expect(served.contentType).toBe('image/jpeg');
    expect(served.buffer).toEqual(cachedBytes);
  });
});
