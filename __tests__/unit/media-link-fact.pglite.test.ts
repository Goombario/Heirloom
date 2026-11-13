import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import {
  getAllMediaLinks,
  getMediaForOwner,
  getMediaGalleryForOwner,
  getLowestMediaLinkForPerson,
  linkMedia,
  setPrimaryMediaLink,
  unlinkMedia,
} from '@/lib/db/queries/media-links';
import { getMediaForPerson } from '@/lib/db/queries/media-tags';
import { getMediaByPersonId } from '@/lib/db/queries/media';
import { linkMediaForOwnerService } from '@/lib/services/media-links';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/** Fact-scoped media links (#905, ADR 0030). */
describe('MediaLink.OwnerFact', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
  });

  beforeEach(async () => {
    await query('TRUNCATE "MediaTag", "MediaLink", "Media", "FamilyPerson", "Families", "People", "Trees", "Users" RESTART IDENTITY CASCADE');
    await query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'fact@example.test', 'fact-g1')`);
    await query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'Fact tree')`);
    await query(`INSERT INTO "People" ("Id", "UserId", "TreeId", "FirstName") VALUES (10, 1, 1, 'Ann'), (11, 1, 1, 'Bob')`);
    await query(`INSERT INTO "Families" ("Id", "UserId", "TreeId", "Partner1Id", "Partner2Id") VALUES (100, 1, 1, 10, 11)`);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  async function media(title: string): Promise<number> {
    const result = await query(
      `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath") VALUES (1, 1, $1, $2) RETURNING "Id"`,
      [title, `${title}.jpg`],
    );
    return (result.rows[0] as { Id: number }).Id;
  }

  it('keeps a link to the person and a link to their birth as two links', async () => {
    const photo = await media('certificate');
    await linkMedia(photo, 'People', 10);
    await linkMedia(photo, 'People', 10, 'Birth');
    await linkMedia(photo, 'People', 10, 'Birth'); // idempotent

    expect((await getAllMediaLinks(1)).map((l) => l.OwnerFact)).toEqual([null, 'Birth']);
    expect(await unlinkMedia(photo, 'People', 10, 1, 'Birth')).toBe(true);
    expect((await getAllMediaLinks(1)).map((l) => l.OwnerFact)).toEqual([null]);
    expect(await unlinkMedia(photo, 'People', 10, 1, 'Birth')).toBe(false);
  });

  it('lists a fact panel by its fact, and the owner list once per photo with its facts', async () => {
    const both = await media('both');
    const birthOnly = await media('birth');
    const deathOnly = await media('death');
    await linkMedia(both, 'People', 10);
    await linkMedia(both, 'People', 10, 'Death');
    await linkMedia(birthOnly, 'People', 10, 'Birth');
    await linkMedia(deathOnly, 'People', 10, 'Death');

    const birth = await getMediaGalleryForOwner('People', 10, 1, 'Birth');
    expect(birth.map((m) => [m.Id, m.IsExplicit, m.OwnerFacts])).toEqual([[birthOnly, true, ['Birth']]]);
    expect((await getMediaForOwner('People', 10, 1, 'Death')).map((m) => m.Id)).toEqual([both, deathOnly]);
    expect((await getMediaForOwner('People', 10, 1)).map((m) => m.Id)).toEqual([both]);

    const all = await getMediaGalleryForOwner('People', 10, 1);
    expect(all.map((m) => [m.Id, m.IsExplicit, m.OwnerFacts])).toEqual([
      [both, true, ['Death']],
      [birthOnly, false, ['Birth']],
      [deathOnly, false, ['Death']],
    ]);

    const gallery = await getMediaForPerson(10, 1);
    expect(gallery.map((m) => [m.Id, m.IsOwned, m.OwnerFacts])).toEqual([
      [both, true, ['Death']],
      [birthOnly, true, ['Birth']],
      [deathOnly, true, ['Death']],
    ]);
    expect((await getMediaByPersonId(10, 1)).map((m) => m.Id)).toEqual([both, birthOnly, deathOnly]);
  });

  it('lists marriage media with the family, labelled', async () => {
    const photo = await media('wedding');
    await linkMedia(photo, 'Families', 100, 'Marriage');
    expect((await getMediaGalleryForOwner('Families', 100, 1)).map((m) => [m.Id, m.IsExplicit, m.OwnerFacts]))
      .toEqual([[photo, false, ['Marriage']]]);
    expect((await getMediaGalleryForOwner('Families', 100, 1, 'Marriage')).map((m) => m.Id)).toEqual([photo]);
  });

  it('never makes a fact link the portrait', async () => {
    const photo = await media('certificate');
    await linkMedia(photo, 'People', 10, 'Birth');
    await setPrimaryMediaLink(photo, 10);
    expect((await getAllMediaLinks(1)).map((l) => l.IsPrimary)).toEqual([0]);
    expect(await getLowestMediaLinkForPerson(10, 1, null)).toBeNull();
    await expect(query(
      `UPDATE "MediaLink" SET "IsPrimary" = 1 WHERE "MediaId" = $1`,
      [photo],
    )).rejects.toThrow(/medialink_primary_record_level/);
  });

  it('rejects a fact on the wrong owner table', async () => {
    const photo = await media('x');
    await expect(query(
      `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "OwnerFact") VALUES ($1, 'Families', 100, 'Birth')`,
      [photo],
    )).rejects.toThrow(/medialink_owner_fact/);
    await expect(linkMediaForOwnerService({
      mediaId: photo, ownerTable: 'People', ownerId: 10, ownerFact: 'Marriage',
      requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1,
    })).rejects.toThrow(/Invalid ownerFact/);
    await linkMediaForOwnerService({
      mediaId: photo, ownerTable: 'Families', ownerId: 100, ownerFact: 'Marriage',
      requestedTreeId: 1, requestedOwnerId: null, currentUserId: 1,
    });
    expect((await getAllMediaLinks(1)).map((l) => [l.OwnerTable, l.OwnerFact])).toEqual([['Families', 'Marriage']]);
  });
});
