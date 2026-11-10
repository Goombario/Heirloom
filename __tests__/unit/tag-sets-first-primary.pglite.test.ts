import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { LocalDataClient } from '@/lib/data/local';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { __resetLocalUserCache } from '@/lib/data/local-user';
import { truncateAllTables } from '../setup/pglite-truncate';
import { primaryPhotoJoin } from '@/lib/db/queries/media-tags';
import type { UpdateMediaTagInput } from '@/lib/data/types';
import { buildJpegWithXmp, mwgPacket } from '../fixtures/xmp/build-fixture';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// Same stub as local-media-faces: no canvas in Node, so the re-encode step is
// skipped and the original bytes are stored.
vi.mock('@/lib/media/process-image', () => ({
  processForUpload: async (file: File) => ({
    bytes: new Uint8Array(await file.arrayBuffer()),
    contentType: 'image/jpeg', format: 'JPG', width: 100, height: 100,
  }),
  downscaleToThumb: async () => null,
}));

function photo(faces: string[] = []): File {
  const bytes = buildJpegWithXmp(mwgPacket(faces.map((name, i) => ({ name, x: 0.2 + i * 0.3, y: 0.3, w: 0.1, h: 0.1 }))));
  return new File([bytes as BlobPart], 'group.jpg', { type: 'image/jpeg' });
}

type AuditChanges = { summary?: unknown; snapshot?: Record<string, unknown> };

const region = { RegionX: 40, RegionY: 20, RegionW: 10, RegionH: 12 };

async function primaryOf(personId: number): Promise<number | null> {
  const r = await query(
    `SELECT "MediaId" FROM "MediaLink" WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 AND "IsPrimary" = 1`,
    [personId],
  );
  return (r.rows[0] as { MediaId: number } | undefined)?.MediaId ?? null;
}

/**
 * #922: tagging a face makes the photo the person's profile picture when they
 * have none, and undoing that tag puts them back to none. Runs the local
 * (PGlite) client end to end; hosted shares the same services.
 */
describe('a face tag sets a first profile picture (#922)', () => {
  let db: PGlite;
  let client: LocalDataClient;
  beforeAll(async () => { db = await newEmptyClusterDb(); __setTestDb(db); await query('SELECT 1'); });
  beforeEach(async () => { await truncateAllTables(db); __resetLocalUserCache(); client = new LocalDataClient(); });
  afterAll(async () => { __setTestDb(null); await db.close(); });

  it('sets the primary for someone with none, cropped to their tag, and audits it', async () => {
    const ada = await client.people.create({ FirstName: 'Ada', LastName: 'Whitcombe' });
    const media = await client.media.upload({ file: photo(), title: 'Reunion' });

    const tag = await client.media.createTag(media.Id, { PersonId: ada.Id, ...region });

    expect(await primaryOf(ada.Id)).toBe(media.Id);
    // The avatar's focal point is the tag's centre, not the photo's.
    const avatar = await query(
      `SELECT m."Id", m."FocalX", m."FocalY" FROM "People" p ${primaryPhotoJoin('p', 'p."TreeId"', 'm')} WHERE p."Id" = $1`,
      [ada.Id],
    );
    expect(avatar.rows[0]).toMatchObject({ Id: media.Id, FocalX: 45, FocalY: 26 });

    const audit = await query(
      `SELECT "EntityType", "Changes" FROM "AuditLog" WHERE "EntityType" IN ('mediatag', 'media') ORDER BY "Id"`,
    );
    const rows = audit.rows as Array<{ EntityType: string; Changes: AuditChanges }>;
    expect(rows.find(r => r.EntityType === 'mediatag')?.Changes.snapshot).toMatchObject({ Id: tag.Id, SetPrimary: true });
    expect(rows.find(r => r.EntityType === 'media' && r.Changes.summary)?.Changes).toMatchObject({
      summary: { kind: 'canonical_primary' },
      fields: { CanonicalPrimaryMediaId: { old: null, new: media.Id } },
    });
  });

  it('never replaces an existing primary', async () => {
    const ada = await client.people.create({ FirstName: 'Ada', LastName: 'Whitcombe' });
    const first = await client.media.upload({ file: photo(), title: 'Portrait' });
    const second = await client.media.upload({ file: photo(), title: 'Group' });
    await client.media.setPrimary(first.Id, ada.Id);

    await client.media.createTag(second.Id, { PersonId: ada.Id, ...region });

    expect(await primaryOf(ada.Id)).toBe(first.Id);
    const snap = await query(`SELECT "Changes" FROM "AuditLog" WHERE "EntityType" = 'mediatag'`);
    expect((snap.rows[0] as { Changes: AuditChanges }).Changes.snapshot?.SetPrimary).toBeUndefined();
  });

  it('removing the tag that set it clears the primary back to none', async () => {
    const ada = await client.people.create({ FirstName: 'Ada', LastName: 'Whitcombe' });
    const other = await client.media.upload({ file: photo(), title: 'Attached' });
    await query(`INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId") VALUES ($1, 'People', $2)`, [other.Id, ada.Id]);
    const media = await client.media.upload({ file: photo(), title: 'Reunion' });
    // Ada already had a linked photo but no primary: the tag still sets one.
    const tag = await client.media.createTag(media.Id, { PersonId: ada.Id, ...region });
    expect(await primaryOf(ada.Id)).toBe(media.Id);

    await client.media.removeTag(media.Id, tag.Id);

    // Back to none: no fallback onto the other linked photo or this one.
    expect(await primaryOf(ada.Id)).toBeNull();
  });

  it('removing a tag on a primary the user chose keeps the old fallback', async () => {
    const ada = await client.people.create({ FirstName: 'Ada', LastName: 'Whitcombe' });
    const portrait = await client.media.upload({ file: photo(), title: 'Portrait' });
    const media = await client.media.upload({ file: photo(), title: 'Reunion' });
    await client.media.setPrimary(portrait.Id, ada.Id);
    const tag = await client.media.createTag(media.Id, { PersonId: ada.Id, ...region });
    await client.media.setPrimary(media.Id, ada.Id);

    await client.media.removeTag(media.Id, tag.Id);

    // Unchanged from before #922: the lowest remaining link becomes primary.
    expect(await primaryOf(ada.Id)).toBe(portrait.Id);
  });

  it('a tag moved to someone else never counts as setting their primary', async () => {
    const ada = await client.people.create({ FirstName: 'Ada', LastName: 'Whitcombe' });
    const bob = await client.people.create({ FirstName: 'Bob', LastName: 'Whitcombe' });
    const portrait = await client.media.upload({ file: photo(), title: 'Portrait' });
    const media = await client.media.upload({ file: photo(), title: 'Reunion' });
    await client.media.setPrimary(portrait.Id, bob.Id);
    await client.media.setPrimary(media.Id, bob.Id);
    // The tag set Ada's primary, then was moved to Bob, whose primary he chose.
    const tag = await client.media.createTag(media.Id, { PersonId: ada.Id, ...region });
    // The client type only offers the region; the service also accepts PersonId.
    await client.media.updateTag(media.Id, tag.Id, { PersonId: bob.Id } as unknown as UpdateMediaTagInput);

    await client.media.removeTag(media.Id, tag.Id);

    // Bob keeps the usual fallback instead of going to none.
    expect(await primaryOf(bob.Id)).not.toBeNull();
  });

  it('reverting the tag from the audit log also clears the primary it set', async () => {
    const ada = await client.people.create({ FirstName: 'Ada', LastName: 'Whitcombe' });
    const media = await client.media.upload({ file: photo(), title: 'Reunion' });
    await client.media.createTag(media.Id, { PersonId: ada.Id, ...region });
    const entry = await query(`SELECT "Id" FROM "AuditLog" WHERE "EntityType" = 'mediatag' AND "Action" = 'create'`);

    await client.audit.revert([(entry.rows[0] as { Id: number }).Id]);

    expect(await primaryOf(ada.Id)).toBeNull();
  });

  it('a batch confirm sets one primary per person, the first confirmed, and undo clears it', async () => {
    const ada = await client.people.create({ FirstName: 'Ada', LastName: 'Whitcombe' });
    const first = await client.media.upload({ file: photo(['Ada Whitcombe']), title: 'One' });
    await client.media.upload({ file: photo(['Ada Whitcombe']), title: 'Two' });
    const candidates = await query(`SELECT "Id", "MediaId" FROM "MediaFaceCandidate" ORDER BY "MediaId"`);
    const ids = (candidates.rows as Array<{ Id: number }>).map(r => r.Id);

    const result = await client.media.confirmFaces(ids, ada.Id);
    expect(result.confirmedCount).toBe(2);
    expect(await primaryOf(ada.Id)).toBe(first.Id);

    await client.media.undoFaces(ids);
    expect(await primaryOf(ada.Id)).toBeNull();
  });
});
