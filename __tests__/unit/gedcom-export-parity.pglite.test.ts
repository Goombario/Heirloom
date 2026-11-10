import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { seedRoundTripFixture, type FixtureIds } from '../setup/gedcom-roundtrip-fixture';
import { readBundle, normalizeBundle, stageFixtureMedia, type Bundle } from '../setup/gedcom-bundle';
import { normalizeGedcomArchivePaths } from '../setup/gedcom-canonical';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * The GEDCOM export is assembled twice: `exportGedcomService` for the hosted
 * server (media from disk, archiver) and `exportGedcomLocalService` for the
 * static and desktop builds (media from MediaBlob, JSZip). Both feed the same
 * `assembleGedcomExport`, but the reads and sidecars around it are copied code,
 * so a fix to one has drifted from the other before. Same tree, same bytes,
 * same bundle (#868).
 *
 * The one deliberate difference is the archive basename: hosted keeps the
 * uploaded file's name, local names the blob `media.<format>`. The FILE lines
 * and zip entries are compared by media xref folder, not basename.
 */
describe('hosted and local GEDCOM export assemble the same bundle', () => {
  let mdb: PGlite;
  let ids: FixtureIds;
  let restoreDataDir: () => void;

  beforeAll(async () => {
    mdb = await newEmptyClusterDb();
    __setTestDb(mdb);
    await query('SELECT 1');
    ids = await seedRoundTripFixture(mdb);
    // Hosted reads the staged files; local reads the same bytes from MediaBlob.
    restoreDataDir = await stageFixtureMedia(mdb, ids);
    const mediaDir = path.join(process.env.DATA_DIR!, 'uploads', String(ids.userId), 'media');
    const { rows } = await mdb.query<{ Id: number; FilePath: string }>(
      'SELECT "Id", "FilePath" FROM "Media" WHERE "TreeId" = $1 AND "FilePath" IS NOT NULL',
      [ids.treeId],
    );
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      const bytes = fs.readFileSync(path.join(mediaDir, row.FilePath.replaceAll('/', path.sep)));
      await mdb.query('INSERT INTO "MediaBlob" ("MediaId", "Data") VALUES ($1, $2)', [row.Id, bytes]);
    }
  }, 60_000);
  afterAll(async () => {
    restoreDataDir?.();
    __setTestDb(null);
    await mdb.close();
  });

  async function exportBoth(includeMedia: boolean) {
    const { exportGedcomService } = await import('@/lib/services/gedcom-export');
    const { exportGedcomLocalService } = await import('@/lib/data/local/gedcom-export');
    const hosted = await exportGedcomService({
      requestedTreeId: ids.treeId, requestedOwnerId: null, currentUserId: ids.userId, includeMedia,
    });
    const local = await exportGedcomLocalService({
      requestedTreeId: ids.treeId, currentUserId: ids.userId, includeMedia,
    });
    return { hosted, local };
  }

  /** Zip media entries keyed by xref (`media/O3-…` → `media/O3`) → content hash. */
  function mediaByFolder(bundle: Bundle): Record<string, string> {
    return Object.fromEntries(
      [...bundle.mediaFiles].map(([name, hash]) => [name.replace(/^(media\/O\d+)-.*$/, '$1'), hash]),
    );
  }

  it('writes the same .ged and preflight', async () => {
    const { hosted, local } = await exportBoth(false);
    if (hosted.kind !== 'ged' || local.kind !== 'ged') throw new Error('expected plain .ged exports');
    expect(local.preflight).toEqual(hosted.preflight);
    expect(normalizeGedcomArchivePaths(local.content)).toBe(normalizeGedcomArchivePaths(hosted.content));
    expect(local.content.startsWith('﻿0 HEAD')).toBe(true);
  });

  it('writes the same zip: .ged, every sidecar and every media file', async () => {
    const { hosted, local } = await exportBoth(true);
    if (hosted.kind !== 'zip' || local.kind !== 'zip') throw new Error('expected zip bundles');
    expect(local.preflight).toEqual(hosted.preflight);
    expect(hosted.preflight.canExport).toBe(true);

    const h = normalizeBundle(await readBundle(hosted.buffer));
    const l = normalizeBundle(await readBundle(Buffer.from(await local.blob.arrayBuffer())));

    expect(normalizeGedcomArchivePaths(l.ged)).toBe(normalizeGedcomArchivePaths(h.ged));
    expect(l.cases).toEqual(h.cases);
    expect(l.sources).toEqual(h.sources);
    expect(l.places).toEqual(h.places);
    expect(l.media).toEqual(h.media);

    const hostedMedia = mediaByFolder(h);
    expect(Object.keys(hostedMedia).length).toBeGreaterThan(1);
    expect(mediaByFolder(l)).toEqual(hostedMedia);
  });
});
