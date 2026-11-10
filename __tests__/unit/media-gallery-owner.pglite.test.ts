import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { getMediaGalleryForOwner, getMediaForOwner, linkMedia } from '@/lib/db/queries/media-links';
import { getAllMediaWithPerson } from '@/lib/db/queries/media';
import type { OwnerGalleryMedia } from '@/lib/db/schema';
import { listGalleryForOwnerService } from '@/lib/services/media-links';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

describe('owner media gallery query', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
  });

  beforeEach(async () => {
    await query('TRUNCATE "MediaTag", "MediaLink", "Media", "FamilyPerson", "Families", "People", "Events", "Sources", "Trees", "Users" RESTART IDENTITY CASCADE');
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'gallery@example.test', 'gallery-g1')`);
    await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Gallery tree'), (2, 1, 'Other tree')`);
    await query(`
      INSERT INTO "People" ("Id", "UserId", "TreeId", "FirstName") VALUES
        (10, 1, 1, 'Partner one'), (11, 1, 1, 'Partner two'),
        (12, 1, 1, 'Child one'), (13, 1, 1, 'Child two'),
        (14, 1, 1, 'Foreign member'), (20, 1, 2, 'Other tree person')
    `);
    await query(`
      INSERT INTO "Families" ("Id", "UserId", "TreeId", "Partner1Id", "Partner2Id")
      VALUES (100, 1, 1, 10, 11), (200, 1, 2, 20, NULL)
    `);
    await query(`INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId") VALUES (100, 12), (100, 13)`);
    await query(`INSERT INTO "Sources" ("Id", "TreeId", "Title") VALUES (300, 1, 'Source')`);
    await query(`INSERT INTO "Events" ("Id", "UserId", "TreeId", "Type", "FamilyId") VALUES (400, 1, 1, 'MARR', 100)`);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  async function media(title: string, treeId = 1): Promise<number> {
    const result = await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath") VALUES (1, $1, $2, $3) RETURNING "Id"`,
      [treeId, title, `${title}.jpg`],
    );
    return (result.rows[0] as { Id: number }).Id;
  }

  async function tag(mediaId: number, personId: number): Promise<void> {
    await query(
      `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH") VALUES ($1, $2, 1, 1, 10, 10)`,
      [mediaId, personId],
    );
  }

  it('returns qualifying family media once, in id order, with explicit and inferred capabilities', async () => {
    const explicitOnly = await media('explicit only');
    const twoPartners = await media('two partners');
    const twoChildren = await media('two children');
    const oneMember = await media('one member');
    const explicitAndInferred = await media('explicit and inferred');
    const foreignTag = await media('foreign tag');
    const unrelated = await media('unrelated');

    await linkMedia(explicitOnly, 'Families', 100);
    await tag(twoPartners, 10);
    await tag(twoPartners, 11);
    await tag(twoChildren, 12);
    await tag(twoChildren, 13);
    await tag(oneMember, 10);
    await linkMedia(explicitAndInferred, 'Families', 100);
    await tag(explicitAndInferred, 10);
    await tag(explicitAndInferred, 12);
    await tag(foreignTag, 10);
    await tag(foreignTag, 20);
    await tag(unrelated, 14);

    const rows = await getMediaGalleryForOwner('Families', 100, 1);
    expect(rows).toEqual([
      expect.objectContaining({ Id: explicitOnly, IsExplicit: true, IsInferred: false }),
      expect.objectContaining({ Id: twoPartners, IsExplicit: false, IsInferred: true }),
      expect.objectContaining({ Id: twoChildren, IsExplicit: false, IsInferred: true }),
      expect.objectContaining({ Id: explicitAndInferred, IsExplicit: true, IsInferred: true }),
    ] satisfies Array<Partial<OwnerGalleryMedia>>);
    expect(rows.map(row => row.Id)).toEqual([explicitOnly, twoPartners, twoChildren, explicitAndInferred]);
  });

  it('keeps listForOwner explicit-only and returns explicit-only rows for non-family owners', async () => {
    const familyTagged = await media('family tagged');
    const familyExplicit = await media('family explicit');
    const sourceExplicit = await media('source explicit');
    const eventExplicit = await media('event explicit');
    await tag(familyTagged, 10);
    await tag(familyTagged, 11);
    await linkMedia(familyExplicit, 'Families', 100);
    await linkMedia(sourceExplicit, 'Sources', 300);
    await linkMedia(eventExplicit, 'Events', 400);

    expect((await getMediaForOwner('Families', 100, 1)).map(row => row.Id)).toEqual([familyExplicit]);
    expect(await getMediaGalleryForOwner('Sources', 300, 1)).toEqual([
      expect.objectContaining({ Id: sourceExplicit, IsExplicit: true, IsInferred: false }),
    ]);
    expect(await getMediaGalleryForOwner('Events', 400, 1)).toEqual([
      expect.objectContaining({ Id: eventExplicit, IsExplicit: true, IsInferred: false }),
    ]);
  });

  it('does not infer across trees', async () => {
    const treeTwoMedia = await media('tree two', 2);
    await tag(treeTwoMedia, 20);
    const rows = await getMediaGalleryForOwner('Families', 100, 1);
    expect(rows).toEqual([]);
    expect(await getMediaGalleryForOwner('Families', 200, 2)).toEqual([]);
  });

  it('rejects a missing owner instead of returning an empty gallery', async () => {
    await expect(listGalleryForOwnerService({
      ownerTable: 'Families',
      ownerId: 999,
      requestedTreeId: 1,
      requestedOwnerId: null,
      currentUserId: 1,
    })).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('returns distinct tree-scoped tagged person IDs alongside searchable names', async () => {
    const tagged = await media('tagged', 1);
    const otherTree = await media('other tree tagged', 2);
    await tag(tagged, 10);
    await tag(tagged, 11);
    await tag(otherTree, 20);

    const rows = await getAllMediaWithPerson(1);
    expect(rows).toEqual([
      expect.objectContaining({
        Id: tagged,
        TaggedPersonIds: [10, 11],
        TaggedPersonNames: expect.arrayContaining(['Partner one', 'Partner two']),
      }),
    ]);
  });
});
