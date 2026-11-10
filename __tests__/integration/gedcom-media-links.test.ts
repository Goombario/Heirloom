import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';
import {
  getMediaForOwner,
  getAllMediaLinks,
  linkMedia,
  unlinkMedia,
} from '@/lib/db/queries/media-links';
import { linkMediaForOwnerService } from '@/lib/services/media-links';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { NotFoundError } from '@/lib/data/errors';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// Dedicated, otherwise-unused user id — integration tests run in parallel against
// one Postgres, so this keeps the suite isolated (see gedcom-passthrough.test.ts).
const MEDIA_USER = 987656;

function gedFile(text: string): File {
  return new File([text], 'family_tree.ged', { type: 'text/plain' });
}

d('Media as first-class linkable (Slice 2)', () => {
  // Multi-tree: resolveDefaultTree/resolveTreeScope insert a "Trees" row FK'd to
  // "Users", so this dedicated test user id must actually exist there — seed it
  // once, then resolve its default tree. The GEDCOM import resolves the same
  // default tree and stamps TreeId, so the tree-scoped readers below use treeId.
  let treeId: number;

  beforeAll(async () => {
    await query(
      'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3) ON CONFLICT ("Id") DO NOTHING',
      [MEDIA_USER, `gedcom-media-links-${MEDIA_USER}@test.local`, `google-${MEDIA_USER}`],
    );
    treeId = await resolveDefaultTree(MEDIA_USER);
  });

  afterEach(async () => {
    // Media rows cascade their MediaLink rows on delete (FK ON DELETE CASCADE).
    await query('DELETE FROM "Media" WHERE "UserId" = $1', [MEDIA_USER]);
    await query('DELETE FROM "Sources" WHERE "OwnerId" = $1', [MEDIA_USER]);
    await query('DELETE FROM "Families" WHERE "UserId" = $1', [MEDIA_USER]);
    await query('DELETE FROM "People" WHERE "UserId" = $1', [MEDIA_USER]);
  });

  it('imports an inline family OBJE as Media + MediaLink(Families)', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME H /X/',
      '0 @F1@ FAM', '1 HUSB @I1@',
      '1 OBJE', '2 FILE wedding.jpg', '3 FORM jpeg', '2 TITL Big day',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: MEDIA_USER });

    const fam = await query('SELECT "Id" FROM "Families" WHERE "UserId" = $1 LIMIT 1', [MEDIA_USER]);
    const familyId = (fam.rows[0] as { Id: number }).Id;
    const media = await getMediaForOwner('Families', familyId, treeId);
    expect(media).toHaveLength(1);
    expect(media[0].Title).toBe('Big day');
    expect(media[0].Format).toBe('jpeg');
    expect((await getAllMediaLinks(treeId)).filter(link => link.MediaId === media[0].Id))
      .toEqual([{ MediaId: media[0].Id, OwnerTable: 'Families', OwnerId: familyId, OwnerFact: null, IsPrimary: 0 }]);
  });

  it('imports event-level OBJE as Media + MediaLink(Events) for person and family events', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME H /X/',
      '1 OCCU Blacksmith', '2 OBJE', '3 FILE forge.jpg', '3 FORM jpeg', '3 TITL At the forge',
      '0 @F1@ FAM', '1 HUSB @I1@',
      '1 DIV', '2 DATE 1950', '2 OBJE', '3 FILE decree.jpg', '3 FORM jpeg', '3 TITL Decree',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: MEDIA_USER });

    const occu = await query(`SELECT "Id" FROM "Events" WHERE "UserId" = $1 AND "Type" = 'OCCU' LIMIT 1`, [MEDIA_USER]);
    const occuMedia = await getMediaForOwner('Events', (occu.rows[0] as { Id: number }).Id, treeId);
    expect(occuMedia).toHaveLength(1);
    expect(occuMedia[0].Title).toBe('At the forge');
    expect((await getAllMediaLinks(treeId)).some(
      link => link.MediaId === occuMedia[0].Id && link.OwnerTable === 'People',
    )).toBe(false);

    const div = await query(`SELECT "Id" FROM "Events" WHERE "UserId" = $1 AND "Type" = 'DIV' LIMIT 1`, [MEDIA_USER]);
    const divMedia = await getMediaForOwner('Events', (div.rows[0] as { Id: number }).Id, treeId);
    expect(divMedia).toHaveLength(1);
    expect(divMedia[0].Title).toBe('Decree');
  });

  it('resolves a standalone OBJE record pointer on a source', async () => {
    const ged = [
      '0 HEAD',
      '0 @S1@ SOUR', '1 TITL Register', '1 OBJE @O1@',
      '0 @O1@ OBJE', '1 FILE scan.pdf', '2 FORM pdf', '1 TITL Page 3',
      '0 TRLR',
    ].join('\n');
    const result = await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: MEDIA_USER });

    const src = await query('SELECT "Id" FROM "Sources" WHERE "OwnerId" = $1 LIMIT 1', [MEDIA_USER]);
    const sourceId = (src.rows[0] as { Id: number }).Id;
    const media = await getMediaForOwner('Sources', sourceId, treeId);
    expect(media.map((m) => m.Title)).toEqual(['Page 3']);
    expect(result.mediaItems).toHaveLength(1);
    expect(result.mediaItems[0]).toMatchObject({
      mediaId: expect.any(Number),
      originalFilename: 'scan.pdf',
      archivePath: 'media/O1/scan.pdf',
      documentMediaId: '@O1@',
      status: 'pending',
    });
  });

  it('overwrite import clears prior media links (no stale accumulation)', async () => {
    const ged1 = ['0 HEAD', '0 @F1@ FAM', '1 OBJE', '2 FILE a.jpg', '0 TRLR'].join('\n');
    await importGedcomService({ file: gedFile(ged1), mode: 'overwrite', currentUserId: MEDIA_USER });
    const ged2 = ['0 HEAD', '0 @F1@ FAM', '1 OBJE', '2 FILE b.jpg', '0 TRLR'].join('\n');
    await importGedcomService({ file: gedFile(ged2), mode: 'overwrite', currentUserId: MEDIA_USER });

    const links = await getAllMediaLinks(treeId);
    expect(links).toHaveLength(1);
  });

  it('data layer: share a media across owners; unlink is unlink-only (media persists)', async () => {
    // Create a non-person media row and link it to two synthetic owners.
    const ins = await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath")
       VALUES ($1, $2, 'Doc', 'doc.pdf') RETURNING "Id"`,
      [MEDIA_USER, treeId]
    );
    const mediaId = (ins.rows[0] as { Id: number }).Id;
    await linkMedia(mediaId, 'Families', 4001);
    await linkMedia(mediaId, 'Sources', 5001);

    expect(await getMediaForOwner('Families', 4001, treeId)).toHaveLength(1);
    expect(await getMediaForOwner('Sources', 5001, treeId)).toHaveLength(1);

    // Unlink one owner: media survives (still linked elsewhere).
    await unlinkMedia(mediaId, 'Families', 4001, treeId);
    expect(await getMediaForOwner('Families', 4001, treeId)).toHaveLength(0);
    expect(await getMediaForOwner('Sources', 5001, treeId)).toHaveLength(1);

    // Unlink the last owner: detach is unlink-only (#86) — the Media row persists
    // in the library even with no remaining links.
    await unlinkMedia(mediaId, 'Sources', 5001, treeId);
    const left = await query('SELECT COUNT(*)::text AS c FROM "Media" WHERE "Id" = $1', [mediaId]);
    expect((left.rows[0] as { c: string }).c).toBe('1');
  });

  it('linkMediaForOwnerService attaches an existing media to an in-tree owner', async () => {
    await query(`INSERT INTO "Families" ("Id", "UserId", "TreeId") VALUES (7001, $1, $2)`, [MEDIA_USER, treeId]);
    const ins = await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath")
       VALUES ($1, $2, 'Lib', 'lib.jpg') RETURNING "Id"`,
      [MEDIA_USER, treeId]
    );
    const mediaId = (ins.rows[0] as { Id: number }).Id;

    await linkMediaForOwnerService({ mediaId, ownerTable: 'Families', ownerId: 7001, requestedTreeId: null, requestedOwnerId: null, currentUserId: MEDIA_USER });
    expect(await getMediaForOwner('Families', 7001, treeId)).toHaveLength(1);
  });

  it('rejects linking onto an owner row not in the tree (IDOR)', async () => {
    // Owner family belongs to a different user; MEDIA_USER must not attach to it.
    const other = 987657;
    await query(`INSERT INTO "Families" ("Id", "UserId") VALUES (7002, $1)`, [other]);
    const ins = await query(
      `INSERT INTO "Media" ("UserId", "Title", "FilePath")
       VALUES ($1, 'Lib', 'lib.jpg') RETURNING "Id"`,
      [MEDIA_USER]
    );
    const mediaId = (ins.rows[0] as { Id: number }).Id;

    await expect(
      linkMediaForOwnerService({ mediaId, ownerTable: 'Families', ownerId: 7002, requestedTreeId: null, requestedOwnerId: null, currentUserId: MEDIA_USER })
    ).rejects.toThrow(NotFoundError);
    await query('DELETE FROM "Families" WHERE "UserId" = $1', [other]);
  });

  it('rejects linking a media that belongs to another tree', async () => {
    const other = 987657;
    // Owner family IS in the tree — this test must fail on the foreign MEDIA, not the owner.
    await query(`INSERT INTO "Families" ("Id", "UserId", "TreeId") VALUES (7003, $1, $2)`, [MEDIA_USER, treeId]);
    const ins = await query(
      `INSERT INTO "Media" ("UserId", "Title", "FilePath")
       VALUES ($1, 'Foreign', 'x.jpg') RETURNING "Id"`,
      [other]
    );
    const foreignMediaId = (ins.rows[0] as { Id: number }).Id;

    await expect(
      linkMediaForOwnerService({ mediaId: foreignMediaId, ownerTable: 'Families', ownerId: 7003, requestedTreeId: null, requestedOwnerId: null, currentUserId: MEDIA_USER })
    ).rejects.toThrow(NotFoundError);
    await query('DELETE FROM "Media" WHERE "UserId" = $1', [other]);
  });

  it('unlink does not delete media after its final canonical person link is removed', async () => {
    await query(`INSERT INTO "People" ("Id", "UserId", "FirstName") VALUES (6, $1, 'Ada')`, [MEDIA_USER]);
    const ins = await query(
      `INSERT INTO "Media" ("UserId", "Title", "FilePath")
       VALUES ($1, 'Portrait', 'p.jpg') RETURNING "Id"`,
      [MEDIA_USER]
    );
    const mediaId = (ins.rows[0] as { Id: number }).Id;
    await linkMedia(mediaId, 'People', 6);

    await unlinkMedia(mediaId, 'People', 6, MEDIA_USER);
    // The link is gone but the independent Media row remains.
    const left = await query('SELECT COUNT(*)::text AS c FROM "Media" WHERE "Id" = $1', [mediaId]);
    expect((left.rows[0] as { c: string }).c).toBe('1');
  });
});
