import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { seedRoundTripFixture, type FixtureIds } from '../setup/gedcom-roundtrip-fixture';
import { stageFixtureMedia } from '../setup/gedcom-bundle';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/** The zip's central directory: entry name → compression method (0 stored, 8 deflated). */
function methods(zip: Buffer): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); i >= 0; i = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), i + 4)) {
    const method = zip.readUInt16LE(i + 10);
    const nameLength = zip.readUInt16LE(i + 28);
    out.set(zip.subarray(i + 46, i + 46 + nameLength).toString('utf8'), method);
  }
  return out;
}

describe('hosted media export streams its zip (#29)', () => {
  let mdb: PGlite;
  let ids: FixtureIds;
  let restoreDataDir: () => void;

  beforeAll(async () => {
    mdb = await newEmptyClusterDb();
    __setTestDb(mdb);
    await query('SELECT 1');
    ids = await seedRoundTripFixture(mdb);
    restoreDataDir = await stageFixtureMedia(mdb, ids);
  }, 60_000);
  afterAll(async () => {
    restoreDataDir?.();
    __setTestDb(null);
    await mdb.close();
  });

  const exportZip = async () => {
    const { exportGedcomService } = await import('@/lib/services/gedcom-export');
    const result = await exportGedcomService({ requestedTreeId: ids.treeId, requestedOwnerId: null, currentUserId: ids.userId, includeMedia: true });
    if (result.kind !== 'zip') throw new Error(`expected a zip, got ${result.kind}`);
    return result.stream;
  };

  it('stores photos as they are and deflates the .ged and sidecars', async () => {
    const zip = Buffer.concat(await Array.fromAsync(await exportZip()));
    const byName = methods(zip);
    const media = [...byName].filter(([name]) => name.startsWith('media/'));
    expect(media.length).toBeGreaterThan(0);
    expect(media.every(([, method]) => method === 0)).toBe(true);
    for (const name of ['family_tree.ged', 'cases.json', 'sources.json', 'places.json', 'media.json']) expect(byName.get(name)).toBe(8);
    // Still a readable zip with every entry.
    const loaded = await JSZip.loadAsync(zip);
    expect(loaded.file('family_tree.ged')).not.toBeNull();
  });

  it('fails the stream when a photo disappears after the export started', async () => {
    const stream = await exportZip();
    // Every photo on disk goes away before the archive reads it.
    const uploads = path.join(process.env.DATA_DIR!, 'uploads');
    const moved = `${uploads}-gone`;
    fs.renameSync(uploads, moved);
    try {
      await expect(Array.fromAsync(stream)).rejects.toThrow(/ENOENT/);
    } finally {
      fs.renameSync(moved, uploads);
    }
  });
});
