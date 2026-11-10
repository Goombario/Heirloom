import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { PGlite } from '@electric-sql/pglite';
import { LocalDataClient } from '@/lib/data/local';
import { getMediaBlobsForExport } from '@/lib/db/queries/gedcom-export';
import { __resetLocalUserCache } from '@/lib/data/local-user';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { truncateAllTables } from '../setup/pglite-truncate';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

describe('Local GEDCOM export (PGlite)', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    __resetLocalUserCache();
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  it('exports a plain GEDCOM without multimedia records or pointers', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Local', LastName: 'Only' });
    await client.media.upload({
      file: new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'portrait.svg', { type: 'image/svg+xml' }),
      personId: person.Id,
    });

    const artifact = await client.gedcom.exportGedcom!();
    expect(artifact.filename).toBe('family_tree.ged');
    const gedcom = await artifact.blob.text();
    expect(gedcom).not.toMatch(/^0 @O\d+@ OBJE$/m);
    expect(gedcom).not.toMatch(/^\d+ OBJE(?: |$)/m);
  });

  it('packages ordinary local MediaBlob bytes and deterministic sidecars', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Local', LastName: 'Photo' });
    await client.media.upload({
      file: new File(['local-bytes'], 'portrait.svg', { type: 'image/svg+xml' }),
      personId: person.Id,
    });

    const first = await client.gedcom.exportGedcom!({ includeMedia: true });
    const second = await client.gedcom.exportGedcom!({ includeMedia: true });
    expect(first.filename).toBe('family_tree_export.zip');
    expect(await first.blob.arrayBuffer()).toEqual(await second.blob.arrayBuffer());

    const zip = await JSZip.loadAsync(await first.blob.arrayBuffer());
    const names = Object.keys(zip.files).sort();
    expect(names).toContain('family_tree.ged');
    expect(names).toContain('cases.json');
    expect(names).toContain('sources.json');
    expect(names).toContain('places.json');
    expect(names).toContain('media.json');
    expect(names).toContain('media/O1-portrait.svg');
    const gedcom = await zip.file('family_tree.ged')!.async('string');
    expect(gedcom).toContain('0 @O1@ OBJE\n1 FILE media/O1-portrait.svg');
    expect(await zip.file('media/O1-portrait.svg')!.async('string')).toBe('local-bytes');
  });

  it('reads MediaBlob bytes through a tree-scoped export query helper', async () => {
    const client = new LocalDataClient();
    const firstTreePerson = await client.people.create({ FirstName: 'Scoped', LastName: 'First' });
    const secondTree = await client.trees.create('Scoped second');
    const secondTreePerson = await client.people.create(
      { FirstName: 'Scoped', LastName: 'Second' },
      { treeId: secondTree.Id },
    );
    const firstMedia = await client.media.upload({
      file: new File(['first-bytes'], 'first.svg', { type: 'image/svg+xml' }),
      personId: firstTreePerson.Id,
    });
    const secondMedia = await client.media.upload({
      file: new File(['second-bytes'], 'second.svg', { type: 'image/svg+xml' }),
      personId: secondTreePerson.Id,
    }, secondTree.Id);

    const rows = await getMediaBlobsForExport(firstTreePerson.TreeId!);

    expect(rows).toEqual([{ Id: firstMedia.Id, Data: new Uint8Array(Buffer.from('first-bytes')) }]);
    expect(rows.map((row) => row.Id)).not.toContain(secondMedia.Id);
  });

  it('reports every unresolved media category without exposing identities', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Media', LastName: 'States' });
    const mediaByState = new Map<string, number>();
    for (const state of ['pending', 'missing', 'failed', 'backing']) {
      const media = await client.media.upload({
        file: new File([state], `${state}.svg`, { type: 'image/svg+xml' }),
        personId: person.Id,
      });
      mediaByState.set(state, media.Id);
      if (state === 'backing') {
        await query('UPDATE "Media" SET "FilePath" = $2 WHERE "Id" = $1', [media.Id, 'disk/backing.svg']);
      }
      await query('DELETE FROM "MediaBlob" WHERE "MediaId" = $1', [media.Id]);
    }
    const legacy = await client.media.upload({
      file: new File(['legacy'], 'legacy.svg', { type: 'image/svg+xml' }),
      personId: person.Id,
    });
    await query('DELETE FROM "MediaBlob" WHERE "MediaId" = $1', [legacy.Id]);
    mediaByState.set('legacy', legacy.Id);
    await query(
      `INSERT INTO "MediaImportItem" ("ImportId", "DocumentMediaId", "TreeId", "MediaId", "ArchivePath", "OriginalFilename", "Status", "FailureCode")
       SELECT $1, $2, "TreeId", $3, $4, $5, $6, $7 FROM "Media" WHERE "Id" = $3`,
      ['import-states', '@O1@', mediaByState.get('pending'), 'pending/file.svg', 'file.svg', 'pending', null],
    );
    await query(
      `INSERT INTO "MediaImportItem" ("ImportId", "DocumentMediaId", "TreeId", "MediaId", "ArchivePath", "OriginalFilename", "Status", "FailureCode")
       SELECT $1, $2, "TreeId", $3, $4, $5, $6, $7 FROM "Media" WHERE "Id" = $3`,
      ['import-states', '@O2@', mediaByState.get('missing'), 'missing/file.svg', 'file.svg', 'missing', 'archive_file_missing'],
    );
    await query(
      `INSERT INTO "MediaImportItem" ("ImportId", "DocumentMediaId", "TreeId", "MediaId", "ArchivePath", "OriginalFilename", "Status", "FailureCode")
       SELECT $1, $2, "TreeId", $3, $4, $5, $6, $7 FROM "Media" WHERE "Id" = $3`,
      ['import-states', '@O3@', mediaByState.get('failed'), 'failed/file.svg', 'file.svg', 'failed', 'materialization_failed'],
    );

    const preflight = await client.gedcom.preflightExport!();
    expect(preflight).toEqual({
      canExport: false,
      omittedTotal: 5,
      byReason: {
        pending: 1,
        missing: 1,
        failed: 1,
        backing_missing: 1,
        legacy_materialization_unknown: 1,
      },
    });
    expect(JSON.stringify(preflight)).not.toMatch(/import-states|backing\.svg|@O[123]@/);
    const overridden = await client.gedcom.exportGedcom!({ includeMedia: true, mediaPolicy: 'omit-unresolved' });
    const zip = await JSZip.loadAsync(await overridden.blob.arrayBuffer());
    const report = await zip.file('missing-media-report.json')!.async('string');
    expect(report).toContain('"total": 5');
    expect(report).not.toMatch(/import-states|backing\.svg|@O[123]@/);
  });

  it('preflights missing local bytes and blocks media export without an override', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Missing', LastName: 'Bytes' });
    const media = await client.media.upload({
      file: new File(['missing-me'], 'missing.svg', { type: 'image/svg+xml' }),
      personId: person.Id,
    });
    await query('DELETE FROM "MediaBlob" WHERE "MediaId" = $1', [media.Id]);

    const preflight = await client.gedcom.preflightExport!();
    expect(preflight.canExport).toBe(false);
    expect(preflight.omittedTotal).toBe(1);
    expect(preflight.byReason.legacy_materialization_unknown).toBe(1);

    await expect(client.gedcom.exportGedcom!({ includeMedia: true })).rejects.toThrow(/media/i);
    const overridden = await client.gedcom.exportGedcom!({ includeMedia: true, mediaPolicy: 'omit-unresolved' });
    const zip = await JSZip.loadAsync(await overridden.blob.arrayBuffer());
    expect(zip.file('missing-media-report.json')).not.toBeNull();
    expect(Object.keys(zip.files).some((name) => name.startsWith('media/O'))).toBe(false);
  });

  it('does not export rows from another tree', async () => {
    const client = new LocalDataClient();
    const first = await client.people.create({ FirstName: 'First', LastName: 'Tree' });
    const secondTree = await client.trees.create('Second tree');
    await client.people.create({ FirstName: 'Second', LastName: 'Tree' }, { treeId: secondTree.Id });
    const artifact = await client.gedcom.exportGedcom!({}, (await client.trees.list()).trees.find((tree) => tree.Id !== secondTree.Id)!.Id);
    const gedcom = await artifact.blob.text();
    expect(gedcom).toContain('First /Tree/');
    expect(gedcom).not.toContain('Second /Tree/');
    expect(first.Id).toBeGreaterThan(0);
  });
});
