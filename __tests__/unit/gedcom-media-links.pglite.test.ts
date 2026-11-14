import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import JSZip from 'jszip';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

const USER_ID = 990009;

function gedFile(text: string): File {
  return new File([text], 'family_tree.ged', { type: 'text/plain' });
}

async function importGedcom(text: string, mode: 'overwrite' | 'merge' = 'overwrite', mediaJson?: string, archiveManifest?: string[]) {
  const { importGedcomService } = await import('@/lib/services/gedcom');
  const treeId = await resolveDefaultTree(USER_ID);
  return importGedcomService({ file: gedFile(text), mode, mediaJson, archiveManifest, currentUserId: USER_ID, requestedTreeId: treeId });
}

describe('GEDCOM media identity and canonical links', () => {
  let db: PGlite;
  let treeId: number;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    await query(
      'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)',
      [USER_ID, `gedcom-media-${USER_ID}@test.local`, `gedcom-media-${USER_ID}`],
    );
    treeId = await resolveDefaultTree(USER_ID);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  it('imports one shared top-level xref once and links every owner exactly once', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ada /Shared/',
      '1 OBJE @O1@', '1 OBJE @O1@',
      '1 OCCU Engineer', '2 OBJE @O1@',
      '0 @F1@ FAM', '1 HUSB @I1@', '1 OBJE @O1@',
      '0 @S1@ SOUR', '1 TITL Register', '1 OBJE @O1@',
      '0 @O1@ OBJE', '1 FILE shared/photo.jpg', '1 FORM jpeg', '1 TITL Shared photo',
      '1 _PRIM @I1@',
      '0 TRLR',
    ].join('\n');

    const result = await importGedcom(ged);
    const media = await query('SELECT "Id", "FilePath" FROM "Media" WHERE "TreeId" = $1', [treeId]);
    const links = await query(
      'SELECT "MediaId", "OwnerTable", "OwnerId", "IsPrimary" FROM "MediaLink" WHERE "MediaId" = $1 ORDER BY "OwnerTable", "OwnerId"',
      [media.rows[0]?.Id ?? -1],
    );

    expect(media.rows).toHaveLength(1);
    expect(links.rows).toHaveLength(4);
    expect(links.rows.map((row) => row.OwnerTable)).toEqual(['Events', 'Families', 'People', 'Sources']);
    expect(links.rows.find((row) => row.OwnerTable === 'People')?.IsPrimary).toBe(1);
    expect(result.mediaItems).toEqual([expect.objectContaining({
      importId: expect.any(String),
      documentMediaId: '@O1@',
      archivePath: 'shared/photo.jpg',
      originalFilename: 'photo.jpg',
      mediaId: media.rows[0].Id,
      status: 'pending',
    })]);
  });

  it('persists one item per referenced media and no item for a no-FILE OBJE', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ada /Items/', '1 OBJE @O1@',
      '1 OCCU Work', '2 OBJE', '3 FILE event.jpg',
      '0 @F1@ FAM', '1 HUSB @I1@', '1 OBJE', '2 FILE family.jpg',
      '0 @S1@ SOUR', '1 TITL Source', '1 OBJE', '2 FILE source.jpg',
      '0 @O1@ OBJE', '1 FILE top.jpg',
      '0 @O2@ OBJE', '1 TITL No file',
      '0 TRLR',
    ].join('\n');
    const result = await importGedcom(ged, 'overwrite', undefined);
    expect(result.mediaItems).toHaveLength(4);
    expect(result.mediaItems.map((item) => item.originalFilename)).toEqual([
      'top.jpg', 'source.jpg', 'family.jpg', 'event.jpg',
    ]);
    const allMedia = await query('SELECT "Id" FROM "Media" WHERE "TreeId" = $1 ORDER BY "Id"', [treeId]);
    expect(allMedia.rows).toHaveLength(5);
    const itemIds = new Set(result.mediaItems.map((item) => item.mediaId));
    expect(allMedia.rows.filter((row) => !itemIds.has(row.Id))).toHaveLength(1);
  });

  it('persists the normalized manifest path and creates fresh lineage on repeated import', async () => {
    const ged = ['0 HEAD', '0 @O1@ OBJE', '1 FILE declared/photo.jpg', '0 TRLR'].join('\n');
    const first = await importGedcom(ged, 'overwrite', undefined, ['./declared/photo.jpg']);
    const second = await importGedcom(ged, 'merge', undefined, ['declared/photo.jpg']);
    expect(first.mediaItems[0].archivePath).toBe('declared/photo.jpg');
    expect(second.mediaItems[0].archivePath).toBe('declared/photo.jpg');
    expect(second.mediaItems[0].importId).not.toBe(first.mediaItems[0].importId);
    expect(second.mediaItems[0].mediaId).not.toBe(first.mediaItems[0].mediaId);
  });

  it('rejects unsafe FILE paths before overwrite mutation', async () => {
    const safe = ['0 HEAD', '0 @O1@ OBJE', '1 FILE safe/photo.jpg', '0 TRLR'].join('\n');
    await importGedcom(safe);
    await expect(importGedcom(['0 HEAD', '0 @O2@ OBJE', '1 FILE ../unsafe.jpg', '0 TRLR'].join('\n')))
      .rejects.toThrow(/unsafe|empty/i);
    await expect(importGedcom(['0 HEAD', '0 @O2@ OBJE', '1 FILE photos\\..\\..\\etc\\passwd', '0 TRLR'].join('\n')))
      .rejects.toThrow(/unsafe|empty/i);
    const media = await query('SELECT "Id" FROM "Media" WHERE "TreeId" = $1', [treeId]);
    expect(media.rows).toHaveLength(1);
  });

  it('keeps an absolute or URL FILE as a pending reference and exports its text back (#958)', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ada /Desktop/', '1 OBJE @O1@',
      '1 OBJE', '2 FILE http://example.com/scans/a%20b.jpg?size=2', '2 FORM jpg',
      '1 OBJE', '2 FILE c:\\users\\ada\\Photos\\',
      '0 @O1@ OBJE', '1 FILE C:\\FTM\\Tree Media\\portrait.jpg', '2 FORM jpg', '2 TITL Portrait',
      '0 TRLR',
    ].join('\n');

    const result = await importGedcom(ged);
    expect(result.warnings).toContainEqual({ code: 'external_media_references', values: { count: 3 } });
    // Matchable only by file name; the folder path names no file, so it gets no item.
    expect(result.mediaItems.map((item) => [item.archivePath, item.originalFilename])).toEqual([
      ['media/O1/portrait.jpg', 'portrait.jpg'],
      ['a b.jpg', 'a b.jpg'],
    ]);
    const stored = await query('SELECT "SourceFile", "FilePath" FROM "Media" WHERE "TreeId" = $1 ORDER BY "Id"', [treeId]);
    expect(stored.rows).toEqual([
      { SourceFile: 'C:\\FTM\\Tree Media\\portrait.jpg', FilePath: null },
      { SourceFile: 'http://example.com/scans/a%20b.jpg?size=2', FilePath: null },
      { SourceFile: 'c:\\users\\ada\\Photos\\', FilePath: null },
    ]);

    const { exportGedcomService } = await import('@/lib/services/gedcom-export');
    const exported = await exportGedcomService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID, includeMedia: true });
    expect(exported.kind).toBe('zip');
    if (exported.kind !== 'zip') return;
    expect(exported.preflight.omittedTotal).toBe(0);
    const zip = await JSZip.loadAsync(exported.buffer);
    const gedName = Object.keys(zip.files).find((name) => name.endsWith('.ged'))!;
    const text = await zip.file(gedName)!.async('string');
    expect(text).toContain('1 FILE C:\\FTM\\Tree Media\\portrait.jpg');
    expect(text).toContain('1 FILE http://example.com/scans/a%20b.jpg?size=2');
    expect(text).toContain('1 FILE c:\\users\\ada\\Photos\\');

    await importGedcom(text);
    const again = await query('SELECT "SourceFile" FROM "Media" WHERE "TreeId" = $1 ORDER BY "SourceFile"', [treeId]);
    expect(again.rows.map((row) => row.SourceFile)).toEqual(stored.rows.map((row) => row.SourceFile).sort());
  });

  it('keeps media under a citation and FILE sub-lines it does not model across export (#976)', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ann /Cite/',
      '1 BIRT', '2 DATE 1900', '2 SOUR @S1@', '3 PAGE p. 4', '3 OBJE @O1@',
      '1 RESI', '2 PLAC Leeds', '2 SOUR @S1@', '3 OBJE', '4 FILE http://example.com/inline.jpg', '4 FORM jpg', '3 QUAY 2',
      '0 @S1@ SOUR', '1 TITL Register',
      '0 @O1@ OBJE', '1 FILE C:\\FTM\\Media\\census.jpg', '2 FORM jpg', '3 TYPE photo', '2 TITL Census',
      '2 _DATE 5/20/2017 2:15:55 PM', '2 _TEXT Year: 1880; Census Place: District 14', '3 CONC ; Film: 1255258',
      '1 _PHOTO_RIN 12345', '2 _X not the FILE\'s',
      '0 TRLR',
    ].join('\n');
    const fileRaw = '1 FORM jpg\n2 TYPE photo\n1 _DATE 5/20/2017 2:15:55 PM\n1 _TEXT Year: 1880; Census Place: District 14\n2 CONC ; Film: 1255258';

    await importGedcom(ged);
    // The citation's OBJE pointer becomes the citation's own file (#47), not the
    // event's; an inline OBJE stays with the citation as passthrough.
    const media = await query('SELECT "Id", "Title", "FileRawGedcom" FROM "Media" WHERE "TreeId" = $1', [treeId]);
    expect(media.rows).toEqual([{ Id: expect.any(Number), Title: 'Census', FileRawGedcom: fileRaw }]);
    const citations = await query('SELECT "Id", "FactTable", "Quay", "RawGedcom" FROM "Citation" WHERE "TreeId" = $1 ORDER BY "Id"', [treeId]);
    expect(citations.rows).toEqual([
      { Id: expect.any(Number), FactTable: 'PersonBirth', Quay: null, RawGedcom: null },
      { Id: expect.any(Number), FactTable: 'Events', Quay: '2', RawGedcom: '1 OBJE\n2 FILE http://example.com/inline.jpg\n2 FORM jpg' },
    ]);
    expect((await query('SELECT "MediaId", "OwnerTable", "OwnerId" FROM "MediaLink"', [])).rows).toEqual([
      { MediaId: media.rows[0].Id, OwnerTable: 'Citation', OwnerId: citations.rows[0].Id },
    ]);

    const { exportGedcomService } = await import('@/lib/services/gedcom-export');
    const exported = await exportGedcomService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID, includeMedia: true });
    if (exported.kind !== 'zip') throw new Error(`expected a zip, got ${exported.kind}`);
    const zip = await JSZip.loadAsync(exported.buffer);
    const gedName = Object.keys(zip.files).find((name) => name.endsWith('.ged'))!;
    const text = (await zip.file(gedName)!.async('string')).split(/\r?\n/).join('\n');
    const xref = /^0 (@[^@]+@) OBJE$/m.exec(text)![1];
    expect(text).toContain(`2 SOUR @S1@\n3 PAGE p. 4\n3 OBJE ${xref}\n`);
    expect(text).toContain('2 SOUR @S1@\n3 OBJE\n4 FILE http://example.com/inline.jpg\n4 FORM jpg\n3 QUAY 2\n');
    expect(text).toContain(`0 ${xref} OBJE\n1 FILE C:\\FTM\\Media\\census.jpg\n2 TITL Census\n2 FORM jpg\n3 TYPE photo\n2 _DATE 5/20/2017 2:15:55 PM\n`);
    expect(text).not.toContain('_X');

    await importGedcom(text);
    const again = await query('SELECT "Id", "FileRawGedcom" FROM "Media" WHERE "TreeId" = $1', [treeId]);
    expect(again.rows).toEqual([{ Id: expect.any(Number), FileRawGedcom: fileRaw }]);
    const citedAgain = await query('SELECT "Id", "RawGedcom" FROM "Citation" WHERE "TreeId" = $1 ORDER BY "Id"', [treeId]);
    expect(citedAgain.rows.map((row) => row.RawGedcom)).toEqual([null, citations.rows[1].RawGedcom]);
    expect((await query('SELECT "MediaId", "OwnerTable", "OwnerId" FROM "MediaLink"', [])).rows).toEqual([
      { MediaId: again.rows[0].Id, OwnerTable: 'Citation', OwnerId: citedAgain.rows[0].Id },
    ]);

    // A second merge of the same file adds no citations, and no second file to
    // the one that has its file already.
    await importGedcom(text, 'merge');
    expect((await query('SELECT COUNT(*)::int AS n FROM "Citation" WHERE "TreeId" = $1', [treeId])).rows[0].n).toBe(2);
    expect((await query(`SELECT COUNT(*)::int AS n FROM "MediaLink" WHERE "OwnerTable" = 'Citation'`, [])).rows[0].n).toBe(1);
    expect((await query('SELECT "RawGedcom" FROM "Citation" WHERE "Id" = $1', [citedAgain.rows[0].Id])).rows[0].RawGedcom).toBeNull();
  });

  it('moves a file pointer an older import left in citation passthrough when a file merges in (#47)', async () => {
    const ged = ['0 HEAD', '0 @I1@ INDI', '1 NAME Ann /Cite/', '1 BIRT', '2 DATE 1900', '2 SOUR @S1@', '3 PAGE p. 4',
      '0 @S1@ SOUR', '1 TITL Register', '0 @O1@ OBJE', '1 FILE census.jpg', '2 FORM jpg', '0 TRLR'].join('\n');
    await importGedcom(ged);
    const media = (await query('SELECT "Id" FROM "Media" WHERE "TreeId" = $1', [treeId])).rows[0];
    const citation = (await query('SELECT "Id" FROM "Citation" WHERE "TreeId" = $1', [treeId])).rows[0];
    // As a tree imported before #47 holds it.
    await query('UPDATE "Citation" SET "RawGedcom" = $1 WHERE "Id" = $2', [`1 OBJE @~O:${media.Id}@\n1 _X kept`, citation.Id]);

    await importGedcom(ged, 'merge');
    expect((await query('SELECT "RawGedcom" FROM "Citation" WHERE "Id" = $1', [citation.Id])).rows[0].RawGedcom).toBe('1 _X kept');
    expect((await query(`SELECT "MediaId" FROM "MediaLink" WHERE "OwnerTable" = 'Citation' AND "OwnerId" = $1`, [citation.Id])).rows)
      .toEqual([{ MediaId: media.Id }]);
  });

  it('drops a media pointer kept before #979 instead of pointing it at another image, and counts it (ADR 0030)', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ann /Stale/', '1 OBJE @O7@',
      '1 BIRT', '2 DATE 1900', '2 OBJE @O9@',
      '1 DEAT', '2 DATE 1980',
      '0 @O7@ OBJE', '1 FILE portrait.jpg', '2 TITL Portrait',
      '0 @O9@ OBJE', '1 FILE certificate.jpg', '2 TITL Certificate',
      '0 TRLR',
    ].join('\n');
    await importGedcom(ged);
    const media = await query('SELECT "Id", "Title" FROM "Media" WHERE "TreeId" = $1 ORDER BY "Id"', [treeId]);
    const idOf = (title: string) => media.rows.find((row) => row.Title === title)!.Id as number;
    // Before #979 the passthrough kept the file's own xref. `@O1@` is the xref the
    // export gives the portrait, so re-emitting it would point the death at the wrong image.
    await query(
      'UPDATE "People" SET "DeathRawGedcom" = $1 WHERE "TreeId" = $2',
      ['2 OBJE @O1@\n3 TITL kept with its pointer', treeId],
    );

    const { exportGedcomService } = await import('@/lib/services/gedcom-export');
    const exported = await exportGedcomService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID, includeMedia: true });
    if (exported.kind !== 'zip') throw new Error(`expected a zip, got ${exported.kind}`);
    const zip = await JSZip.loadAsync(exported.buffer);
    const gedName = Object.keys(zip.files).find((name) => name.endsWith('.ged'))!;
    const text = (await zip.file(gedName)!.async('string')).split(/\r?\n/).join('\n');
    const xrefOf = (title: string) => new RegExp(`^0 (@[^@]+@) OBJE\n(?:[1-9].*\n)*?2 TITL ${title}$`, 'm').exec(text)![1];

    // The death keeps its line but loses the pointer and its sub-line.
    expect(text).toMatch(/\n1 DEAT\n2 DATE 1980\n1 /);
    expect(text).not.toContain('kept with its pointer');
    // Every pointer that is exported resolves to the image it named on import.
    expect(text).toContain(`1 OBJE ${xrefOf('Portrait')}\n`);
    expect(text).toMatch(new RegExp(`\n1 BIRT\n2 DATE 1900\n(?:.+\n)*?2 OBJE ${xrefOf('Certificate')}\n`));
    const report = JSON.parse(await zip.file('missing-media-report.json')!.async('string'));
    expect(report.staleMediaPointers).toBe(1);
    expect(report.omitted.total).toBe(0);

    await importGedcom(text);
    const again = await query(
      `SELECT m."Title", l."OwnerTable", l."OwnerFact" FROM "MediaLink" l JOIN "Media" m ON m."Id" = l."MediaId"
        WHERE m."TreeId" = $1 ORDER BY m."Title"`,
      [treeId],
    );
    expect(again.rows).toEqual([
      { Title: 'Certificate', OwnerTable: 'People', OwnerFact: 'Birth' },
      { Title: 'Portrait', OwnerTable: 'People', OwnerFact: null },
    ]);
    expect(idOf('Portrait')).not.toBe(idOf('Certificate'));
  });

  it('round-trips media under BIRT, DEAT and MARR as fact links, pointer and inline (ADR 0030)', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ann /Fact/', '1 OBJE @O1@', '1 FAMS @F1@',
      '1 BIRT', '2 DATE 1900', '2 OBJE @O2@', '3 _PRIM Y',
      '1 DEAT', '2 OBJE', '3 FILE http://example.com/death.jpg', '3 TITL Death notice',
      '0 @I2@ INDI', '1 NAME Bob /Fact/', '1 FAMS @F1@',
      '0 @F1@ FAM', '1 HUSB @I2@', '1 WIFE @I1@', '1 OBJE @O1@',
      '1 MARR', '2 DATE 1925', '2 OBJE @O3@',
      '0 @O1@ OBJE', '1 FILE portrait.jpg', '2 TITL Portrait',
      '0 @O2@ OBJE', '1 FILE birth.jpg', '2 TITL Birth certificate',
      '0 @O3@ OBJE', '1 FILE wedding.jpg', '2 TITL Wedding',
      '0 TRLR',
    ].join('\n');
    const linksOf = async () => (await query(
      `SELECT m."Title", l."OwnerTable", l."OwnerFact", l."IsPrimary" FROM "MediaLink" l
         JOIN "Media" m ON m."Id" = l."MediaId"
        WHERE m."TreeId" = $1 ORDER BY m."Title", l."OwnerTable"`,
      [treeId],
    )).rows;
    const expected = [
      { Title: 'Birth certificate', OwnerTable: 'People', OwnerFact: 'Birth', IsPrimary: 0 },
      { Title: 'Death notice', OwnerTable: 'People', OwnerFact: 'Death', IsPrimary: 0 },
      { Title: 'Portrait', OwnerTable: 'Families', OwnerFact: null, IsPrimary: 0 },
      { Title: 'Portrait', OwnerTable: 'People', OwnerFact: null, IsPrimary: 0 },
      { Title: 'Wedding', OwnerTable: 'Families', OwnerFact: 'Marriage', IsPrimary: 0 },
    ];

    await importGedcom(ged);
    expect(await linksOf()).toEqual(expected);
    // Nothing is left in the facts' passthrough.
    const raw = await query('SELECT "BirthRawGedcom", "DeathRawGedcom" FROM "People" WHERE "TreeId" = $1', [treeId]);
    expect(raw.rows.every((row) => row.BirthRawGedcom === null && row.DeathRawGedcom === null)).toBe(true);
    expect((await query('SELECT "MarriageRawGedcom" FROM "Families" WHERE "TreeId" = $1', [treeId])).rows[0].MarriageRawGedcom).toBeNull();

    const { exportGedcomService } = await import('@/lib/services/gedcom-export');
    const exported = await exportGedcomService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID, includeMedia: true });
    if (exported.kind !== 'zip') throw new Error(`expected a zip, got ${exported.kind}`);
    const zip = await JSZip.loadAsync(exported.buffer);
    const gedName = Object.keys(zip.files).find((name) => name.endsWith('.ged'))!;
    const text = (await zip.file(gedName)!.async('string')).split(/\r?\n/).join('\n');
    const xrefOf = (title: string) => new RegExp(`^0 (@[^@]+@) OBJE\n(?:[1-9].*\n)*?2 TITL ${title}$`, 'm').exec(text)![1];
    expect(text).toContain(`1 BIRT\n2 DATE 1900\n2 OBJE ${xrefOf('Birth certificate')}\n`);
    expect(text).toContain(`1 DEAT Y\n2 OBJE ${xrefOf('Death notice')}\n`);
    expect(text).toContain(`1 MARR\n2 DATE 1925\n2 OBJE ${xrefOf('Wedding')}\n`);
    // A fact's photo is not also the record's own.
    expect(text.match(/^1 OBJE /gm)).toHaveLength(2);
    expect(zip.file('missing-media-report.json')).toBeNull();

    await importGedcom(text);
    expect(await linksOf()).toEqual(expected);
  });

  it('stores a pointed People primary canonically while retaining face geometry', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ada /Primary/', '1 OBJE @O1@',
      '0 @O1@ OBJE', '1 FILE media/O1/portrait.jpg', '2 FORM jpeg', '2 TITL Portrait',
      '1 _PRIM @I1@',
      '0 TRLR',
    ].join('\n');
    const mediaJson = JSON.stringify({
      version: 2,
      focalGeometry: [],
      tags: [{ media: '@O1@', person: '@I1@', region: [10, 20, 30, 40] }],
    });

    const result = await importGedcom(ged, 'overwrite', mediaJson);

    const row = await query(
      `SELECT m."Id", l."IsPrimary" AS "LinkPrimary", t."RegionX"
       FROM "Media" m
       JOIN "MediaLink" l ON l."MediaId" = m."Id" AND l."OwnerTable" = 'People'
       JOIN "MediaTag" t ON t."MediaId" = m."Id" AND t."PersonId" = l."OwnerId"
       WHERE m."TreeId" = $1`,
      [treeId],
    );

    expect(row.rows).toEqual([{
      Id: expect.any(Number), LinkPrimary: 1, RegionX: 10,
    }]);
    expect(result.mediaItems).toEqual([expect.objectContaining({
      documentMediaId: '@O1@', skipFaceCapture: true,
    })]);
  });

  it('keeps a shared-media primary on the higher-id canonical owner', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ada /Shared/', '1 OBJE @O1@',
      '0 @I2@ INDI', '1 NAME Bea /Shared/', '1 OBJE @O1@',
      '0 @O1@ OBJE', '1 FILE media/O1/shared.jpg', '2 FORM jpeg', '2 TITL Shared',
      '1 _PRIM @I2@',
      '0 TRLR',
    ].join('\n');
    const mediaJson = JSON.stringify({
      version: 2,
      focalGeometry: [],
      tags: [{ media: '@O1@', person: '@I2@', region: [10, 20, 30, 40] }],
    });

    await importGedcom(ged, 'overwrite', mediaJson);

    const row = await query(
      `SELECT l."OwnerId", l."IsPrimary" AS "LinkPrimary", t."RegionX"
       FROM "Media" m
       JOIN "MediaLink" l ON l."MediaId" = m."Id" AND l."OwnerTable" = 'People'
       JOIN "MediaTag" t ON t."MediaId" = m."Id" AND t."PersonId" = l."OwnerId"
       WHERE m."TreeId" = $1`,
      [treeId],
    );
    const people = await query('SELECT "Id", "GedcomId" FROM "People" WHERE "TreeId" = $1 ORDER BY "Id"', [treeId]);

    expect(people.rows).toHaveLength(2);
    expect(row.rows).toEqual([{
      OwnerId: people.rows[1].Id,
      LinkPrimary: 1,
      RegionX: 10,
    }]);
  });

  it('converts a v1 sidecar primary tag into the canonical People link', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ada /Owner/', '1 OBJE @O1@',
      '0 @I2@ INDI', '1 NAME Bea /Tagged/',
      '0 @O1@ OBJE', '1 FILE portrait.jpg', '1 FORM jpeg', '1 TITL Portrait',
      '0 TRLR',
    ].join('\n');
    const mediaJson = JSON.stringify({
      version: 1,
      libraryMedia: [],
      tags: [{ file: 'portrait.jpg', person: '@I2@', region: [10, 20, 30, 40], primary: true }],
    });

    const result = await importGedcom(ged, 'overwrite', mediaJson);

    const row = await query(
      `SELECT l."OwnerId", l."IsPrimary" AS "LinkPrimary", t."RegionX"
       FROM "MediaLink" l
       JOIN "MediaTag" t ON t."MediaId" = l."MediaId" AND t."PersonId" = l."OwnerId"
       WHERE l."OwnerTable" = 'People' AND l."IsPrimary" = 1`,
    );
    const taggedPerson = await query('SELECT "Id" FROM "People" WHERE "TreeId" = $1 AND "GedcomId" = $2', [treeId, '@I2@']);

    expect(row.rows).toEqual([{ OwnerId: taggedPerson.rows[0].Id, LinkPrimary: 1, RegionX: 10 }]);
    expect(result.mediaItems).toEqual([expect.objectContaining({
      documentMediaId: '@O1@', skipFaceCapture: true,
    })]);
  });

  it('creates a durable item for each v1 sidecar library media entry', async () => {
    const ged = ['0 HEAD', '0 @I1@ INDI', '1 NAME Ada /Library/', '0 TRLR'].join('\n');
    const mediaJson = JSON.stringify({
      version: 1,
      libraryMedia: [{ file: 'library/album.jpg', title: 'Album', format: 'jpeg' }],
      tags: [{ file: 'album.jpg', person: '@I1@', region: [1, 2, 30, 40] }],
    });
    const result = await importGedcom(ged, 'overwrite', mediaJson, ['album.jpg']);
    expect(result.mediaItems).toEqual([expect.objectContaining({
      archivePath: 'album.jpg', originalFilename: 'album.jpg', skipFaceCapture: true,
    })]);
    expect(result.mediaItems[0].documentMediaId).not.toBe('@O1@');
  });

  it('keeps an ownerless top-level record as one media row with no links', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Owner /Orphan/',
      '0 @O1@ OBJE', '1 FILE archive/orphan.jpg', '1 FORM jpeg', '1 TITL Orphan',
      '0 TRLR',
    ].join('\n');

    const result = await importGedcom(ged);
    const media = await query('SELECT "Id" FROM "Media" WHERE "TreeId" = $1', [treeId]);
    const links = await query(
      'SELECT "MediaId" FROM "MediaLink" WHERE "MediaId" = $1',
      [media.rows[0].Id],
    );

    expect(media.rows).toHaveLength(1);
    expect(links.rows).toHaveLength(0);
    expect(result.mediaItems).toHaveLength(1);
  });

  it('allows overwrite of a tree with only an ownerless standalone OBJE', async () => {
    const result = await importGedcom([
      '0 HEAD',
      '0 @O1@ OBJE', '1 FILE media/O1/orphan.jpg', '2 FORM jpeg', '2 TITL Orphan',
      '0 TRLR',
    ].join('\n'));
    const media = await query('SELECT "Id", "Title" FROM "Media" WHERE "TreeId" = $1', [treeId]);
    const links = await query('SELECT "MediaId" FROM "MediaLink" WHERE "MediaId" = $1', [media.rows[0]?.Id ?? -1]);

    expect(result.success).toBe(true);
    expect(media.rows).toEqual([{ Id: expect.any(Number), Title: 'Orphan' }]);
    expect(links.rows).toHaveLength(0);
  });

  it('imports bundle v3, v2 and v1 media layouts to the right zip entries (#937)', async () => {
    const twoPhotos = (fileA: string, fileB: string) => [
      '0 HEAD',
      '0 @O1@ OBJE', `1 FILE ${fileA}`, '1 TITL Portrait',
      '0 @O2@ OBJE', `1 FILE ${fileB}`, '1 TITL Portrait',
      '0 TRLR',
    ].join('\n');
    const sidecar = (version: number) => JSON.stringify(
      version === 1 ? { version, libraryMedia: [], tags: [] } : { version, focalGeometry: [], tags: [] },
    );
    const paths = (result: Awaited<ReturnType<typeof importGedcom>>) => result.mediaItems.map((item) => item.archivePath);

    // v3: one flat folder, xref-prefixed names. A bare same-named entry in the zip
    // has the v1 shape, but the exact paths win.
    const v3 = await importGedcom(
      twoPhotos('media/O1-portrait.jpg', 'media/O2-portrait.jpg'), 'overwrite', sidecar(3),
      ['family_tree.ged', 'media.json', 'media/O1-portrait.jpg', 'media/O2-portrait.jpg', 'media/portrait.jpg'],
    );
    expect(paths(v3)).toEqual(['media/O1-portrait.jpg', 'media/O2-portrait.jpg']);

    // v2: a folder per photo.
    const v2 = await importGedcom(
      twoPhotos('media/O1/portrait.jpg', 'media/O2/portrait.jpg'), 'overwrite', sidecar(2),
      ['family_tree.ged', 'media.json', 'media/O1/portrait.jpg', 'media/O2/portrait.jpg'],
    );
    expect(paths(v2)).toEqual(['media/O1/portrait.jpg', 'media/O2/portrait.jpg']);

    // v1: bare names, matched by the file name alone when it is unique.
    const v1 = await importGedcom(
      twoPhotos('first.jpg', 'second.jpg'), 'overwrite', sidecar(1),
      ['family_tree.ged', 'media.json', 'media/first.jpg', 'media/second.jpg'],
    );
    expect(paths(v1)).toEqual(['media/first.jpg', 'media/second.jpg']);
  });

  it('keeps same-basename xrefs distinct', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Owner /Basename/',
      '0 @O1@ OBJE', '1 FILE first/photo.jpg', '1 TITL First',
      '0 @O2@ OBJE', '1 FILE second/photo.jpg', '1 TITL Second',
      '0 TRLR',
    ].join('\n');

    const result = await importGedcom(ged);
    const media = await query('SELECT "Id", "Title" FROM "Media" WHERE "TreeId" = $1 ORDER BY "Id"', [treeId]);

    expect(media.rows).toHaveLength(2);
    expect(media.rows.map((row) => row.Title)).toEqual(['First', 'Second']);
    expect(result.mediaItems.map((item) => [item.originalFilename, item.documentMediaId])).toEqual([
      ['photo.jpg', '@O1@'],
      ['photo.jpg', '@O2@'],
    ]);
  });

  it('skips v1 basename tags and primary association when the basename is ambiguous', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Tagged /Ambiguous/',
      '0 @O1@ OBJE', '1 FILE first/photo.jpg', '1 TITL First',
      '0 @O2@ OBJE', '1 FILE second/photo.jpg', '1 TITL Second',
      '0 TRLR',
    ].join('\n');
    const mediaJson = JSON.stringify({
      version: 1,
      libraryMedia: [],
      tags: [{ file: 'photo.jpg', person: '@I1@', region: [10, 20, 30, 40], primary: true }],
    });

    await importGedcom(ged, 'overwrite', mediaJson);

    const tagged = await query(
      `SELECT mt."Id"
         FROM "MediaTag" mt
         JOIN "Media" m ON m."Id" = mt."MediaId"
        WHERE m."TreeId" = $1`,
      [treeId],
    );
    const primary = await query(
      `SELECT l."MediaId"
         FROM "MediaLink" l
         JOIN "Media" m ON m."Id" = l."MediaId"
        WHERE m."TreeId" = $1 AND l."OwnerTable" = 'People' AND l."IsPrimary" = 1`,
      [treeId],
    );

    expect(tagged.rows).toHaveLength(0);
    expect(primary.rows).toHaveLength(0);
    expect((await query(
      `SELECT "SkipFaceCapture" FROM "MediaImportItem" WHERE "TreeId" = $1 ORDER BY "Id"`,
      [treeId],
    )).rows).toEqual([{ SkipFaceCapture: 0 }, { SkipFaceCapture: 0 }]);
  });

  it('imports legacy inline People media through one canonical People link', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ada /Inline/',
      '1 OBJE', '2 FILE portrait.jpg', '2 FORM jpeg', '2 TITL Portrait', '2 _PRIM Y',
      '0 TRLR',
    ].join('\n');

    await importGedcom(ged);
    const media = await query('SELECT "Id" FROM "Media" WHERE "TreeId" = $1', [treeId]);
    const links = await query(
      'SELECT "OwnerTable", "OwnerId", "IsPrimary" FROM "MediaLink" WHERE "MediaId" = $1',
      [media.rows[0]?.Id ?? -1],
    );
    const people = await query('SELECT "Id" FROM "People" WHERE "TreeId" = $1', [treeId]);

    expect(media.rows).toHaveLength(1);
    expect(links.rows).toEqual([{ OwnerTable: 'People', OwnerId: people.rows[0]?.Id, IsPrimary: 1 }]);
  });

  it('does not reuse pre-existing rows when pointed records have matching metadata', async () => {
    const initial = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ada /ArchiveIdentity/', '1 OBJE @O1@', '1 OBJE @O2@',
      '0 @O1@ OBJE', '1 FILE photo.jpg', '1 TITL First photo',
      '0 @O2@ OBJE', '1 FILE photo.jpg', '1 TITL Second photo',
      '0 TRLR',
    ].join('\n');
    await importGedcom(initial);
    const before = await query('SELECT "Id", "Title" FROM "Media" WHERE "TreeId" = $1 ORDER BY "Id"', [treeId]);
    const person = await query('SELECT "Id" FROM "People" WHERE "TreeId" = $1', [treeId]);
    await query('UPDATE "Media" SET "FilePath" = \'photo.jpg\' WHERE "TreeId" = $1', [treeId]);

    const reordered = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ada /ArchiveIdentity/', '1 OBJE @O1@', '1 OBJE @O2@',
      '0 @O2@ OBJE', '1 FILE photo.jpg', '1 TITL Second photo revised',
      '0 @O1@ OBJE', '1 FILE photo.jpg', '1 TITL First photo revised',
      '0 TRLR',
    ].join('\n');
    await importGedcom(reordered, 'merge');

    const links = await query(
      'SELECT "MediaId" FROM "MediaLink" WHERE "OwnerTable" = \'People\' AND "OwnerId" = $1 ORDER BY "MediaId"',
      [person.rows[0].Id],
    );
    expect(before.rows).toHaveLength(2);
    expect(links.rows).toHaveLength(4);
    expect(links.rows.slice(-2).map((row) => row.MediaId)).not.toEqual(before.rows.map((row) => row.Id));
  });

  it('does not let a subset pointed record consume an unrelated pre-import media row', async () => {
    const initial = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ada /ArchiveSubset/',
      '0 @O1@ OBJE', '1 FILE first.jpg', '1 TITL First',
      '0 @O2@ OBJE', '1 FILE second.jpg', '1 TITL Second',
      '0 TRLR',
    ].join('\n');
    await importGedcom(initial);
    const before = await query('SELECT "Id" FROM "Media" WHERE "TreeId" = $1 ORDER BY "Id"', [treeId]);
    const person = await query('SELECT "Id" FROM "People" WHERE "TreeId" = $1', [treeId]);
    await query('UPDATE "Media" SET "FilePath" = CASE WHEN "Id" = $1 THEN \'first.jpg\' ELSE \'second.jpg\' END WHERE "TreeId" = $2', [before.rows[0].Id, treeId]);
    const unrelated = await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath")
       VALUES ($1, $2, 'Unrelated library item', 'unrelated.jpg') RETURNING "Id"`,
      [USER_ID, treeId],
    );

    const subset = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ada /ArchiveSubset/', '1 OBJE @O2@',
      '0 @O2@ OBJE', '1 FILE second.jpg', '1 TITL Second',
      '0 TRLR',
    ].join('\n');
    await importGedcom(subset, 'merge');

    const links = await query(
      'SELECT "MediaId" FROM "MediaLink" WHERE "OwnerTable" = \'People\' AND "OwnerId" = $1',
      [person.rows[0].Id],
    );
    expect(links.rows).toHaveLength(1);
    expect([before.rows[0].Id, before.rows[1].Id, unrelated.rows[0].Id]).not.toContain(links.rows[0].MediaId);
  });
});
