import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as LIST_TAGS, POST as ADD_TAG } from '@/app/api/media/[id]/tags/route';
import { PUT as UPDATE_TAG, DELETE as DELETE_TAG } from '@/app/api/media/[id]/tags/[tagId]/route';
import { GET as GET_MEDIA, POST as CREATE_MEDIA } from '@/app/api/media/route';
import { POST as SET_PRIMARY } from '@/app/api/media/[id]/primary/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as POST_SHARING } from '@/app/api/sharing/route';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase, onPglite } from '../../setup/db-helpers';
import { query } from '@/lib/db/connection';
import { Client } from 'pg';
import { setPrimaryMediaForPerson } from '@/lib/services/media';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface TagShape {
  Id: number;
  PersonId: number;
  RegionX: number;
  RegionY: number;
  RegionW: number;
  RegionH: number;
  PersonFirstName: string | null;
  IsPersonPrimary: boolean;
}

interface GalleryRow {
  Id: number;
  IsOwned: boolean;
  IsTaggedHere: boolean;
  IsPersonPrimary: boolean;
}

const DEFAULT_REGION = { RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20 };

describeIf('API /api/media/[id]/tags', () => {
  afterEach(async () => {
    await query(`DROP TRIGGER IF EXISTS "fail_primary_tag_delete_trigger" ON "MediaTag"`);
    await query(`DROP FUNCTION IF EXISTS "fail_primary_tag_delete"()`);
    await query(`DROP TRIGGER IF EXISTS "pause_primary_link_trigger" ON "MediaLink"`);
    await query(`DROP FUNCTION IF EXISTS "pause_primary_link"()`);
    await cleanupTestData();
  });

  async function createPerson(firstName: string, lastName = 'Tester'): Promise<number> {
    const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST',
      body: { FirstName: firstName, LastName: lastName },
    }));
    const { person } = await parseResponse<{ person: { Id: number } }>(res);
    return person.Id;
  }

  async function createMedia(personId: number | null): Promise<number> {
    const res = await CREATE_MEDIA(createRequest('http://localhost:3000/api/media', {
      method: 'POST',
      body: { PersonId: personId, Title: 'A group photo' },
    }));
    const { media } = await parseResponse<{ media: { Id: number } }>(res);
    return media.Id;
  }

  function addTag(mediaId: number, personId: number, region = DEFAULT_REGION) {
    return ADD_TAG(
      createRequest(`http://localhost:3000/api/media/${mediaId}/tags`, {
        method: 'POST',
        body: { PersonId: personId, ...region },
      }),
      { params: Promise.resolve({ id: String(mediaId) }) }
    );
  }

  function listTags(mediaId: number) {
    return LIST_TAGS(
      createRequest(`http://localhost:3000/api/media/${mediaId}/tags`),
      { params: Promise.resolve({ id: String(mediaId) }) }
    );
  }

  function galleryFor(personId: number) {
    return GET_MEDIA(createRequest(`http://localhost:3000/api/media?personId=${personId}&includeTagged=true`));
  }

  function setPrimary(mediaId: number, personId: number) {
    return SET_PRIMARY(
      createRequest(`http://localhost:3000/api/media/${mediaId}/primary`, {
        method: 'POST',
        body: { personId },
      }),
      { params: Promise.resolve({ id: String(mediaId) }) },
    );
  }

  describe('POST (add tag)', () => {
    it('audits the tag in the media\'s tree with the tagged person\'s name (#847)', async () => {
      const tagged = await createPerson('Labelled');
      const mediaId = await createMedia(null);
      expect((await addTag(mediaId, tagged)).status).toBe(201);
      const entry = (await query(
        `SELECT a."TreeId", a."EntityLabel", m."TreeId" AS "MediaTreeId"
           FROM "AuditLog" a JOIN "Media" m ON m."Id" = $1
          WHERE a."EntityType" = 'mediatag' ORDER BY a."Id" DESC LIMIT 1`,
        [mediaId],
      )).rows[0] as { TreeId: number | null; EntityLabel: string; MediaTreeId: number };
      expect(entry.TreeId).toBe(entry.MediaTreeId);
      expect(entry.EntityLabel).toBe('Photo tag — Labelled Tester');
    });

    it('does not resurrect a removed canonical owner when adding a different person tag', async () => {
      const removedOwner = await createPerson('RemovedOwner');
      const tagged = await createPerson('CanonicalTagged');
      const mediaId = await createMedia(removedOwner);
      await query(
        `DELETE FROM "MediaLink" WHERE "MediaId" = $1 AND "OwnerTable" = 'People'`,
        [mediaId],
      );

      const res = await addTag(mediaId, tagged);

      expect(res.status).toBe(201);
      expect((await query(
        `SELECT "OwnerId" FROM "MediaLink"
         WHERE "MediaId" = $1 AND "OwnerTable" = 'People' ORDER BY "OwnerId"`,
        [mediaId],
      )).rows).toEqual([{ OwnerId: tagged }]);
    });

    it('tags a person in a photo with their name and region', async () => {
      const subject = await createPerson('Alice');
      const tagged = await createPerson('Bob');
      const mediaId = await createMedia(subject);

      const res = await addTag(mediaId, tagged, { RegionX: 5, RegionY: 5, RegionW: 30, RegionH: 40 });
      expect(res.status).toBe(201);

      const { tag } = await parseResponse<{ tag: TagShape }>(res);
      expect(tag.Id).toBeGreaterThan(0);
      expect(tag.PersonId).toBe(tagged);
      expect(tag.PersonFirstName).toBe('Bob');
      expect(tag.RegionW).toBe(30);
    });

    it('returns 400 when PersonId is missing', async () => {
      const subject = await createPerson('Alice');
      const mediaId = await createMedia(subject);

      const res = await ADD_TAG(
        createRequest(`http://localhost:3000/api/media/${mediaId}/tags`, {
          method: 'POST',
          body: { ...DEFAULT_REGION },
        }),
        { params: Promise.resolve({ id: String(mediaId) }) }
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for a zero-area region', async () => {
      const subject = await createPerson('Alice');
      const tagged = await createPerson('Bob');
      const mediaId = await createMedia(subject);

      const res = await addTag(mediaId, tagged, { RegionX: 10, RegionY: 10, RegionW: 0, RegionH: 20 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when RegionX is missing', async () => {
      const subject = await createPerson('Alice');
      const tagged = await createPerson('Bob');
      const mediaId = await createMedia(subject);

      const res = await ADD_TAG(
        createRequest(`http://localhost:3000/api/media/${mediaId}/tags`, {
          method: 'POST',
          body: { PersonId: tagged, RegionY: 10, RegionW: 20, RegionH: 20 },
        }),
        { params: Promise.resolve({ id: String(mediaId) }) }
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when the person is not in this tree', async () => {
      const subject = await createPerson('Alice');
      const mediaId = await createMedia(subject);

      const res = await addTag(mediaId, 999999);
      expect(res.status).toBe(404);
    });

    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const res = await addTag(1, 1);
      expect(res.status).toBe(401);
    });

    it('view-only shared user gets 403', async () => {
      const subject = await createPerson('Alice');
      const tagged = await createPerson('Bob');
      const mediaId = await createMedia(subject);
      await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
        method: 'POST',
        body: { email: TEST_USER_2.email, permission: 'view' },
      }));

      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const res = await ADD_TAG(
        createRequest(`http://localhost:3000/api/media/${mediaId}/tags?ownerId=${TEST_USER.id}`, {
          method: 'POST',
          body: { PersonId: tagged, ...DEFAULT_REGION },
        }),
        { params: Promise.resolve({ id: String(mediaId) }) }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('GET (list tags)', () => {
    it('lists every tag on a photo', async () => {
      const subject = await createPerson('Alice');
      const bob = await createPerson('Bob');
      const carol = await createPerson('Carol');
      const mediaId = await createMedia(subject);
      await addTag(mediaId, bob);
      await addTag(mediaId, carol);

      const res = await listTags(mediaId);
      expect(res.status).toBe(200);
      const { tags } = await parseResponse<{ tags: TagShape[] }>(res);
      expect(tags).toHaveLength(2);
      expect(tags.map(t => t.PersonId).sort()).toEqual([bob, carol].sort());
    });

    it('derives primary identity from the matching People MediaLink', async () => {
      const owner = await createPerson('Owner');
      const primaryPerson = await createPerson('Primary');
      const otherPerson = await createPerson('Other');
      const mediaId = await createMedia(owner);
      // Other already has a profile picture, so their tag doesn't take this one (#922).
      const otherPortrait = await createMedia(owner);
      expect((await setPrimary(otherPortrait, otherPerson)).status).toBe(200);
      await addTag(mediaId, primaryPerson);
      await addTag(mediaId, otherPerson);
      expect((await setPrimary(mediaId, primaryPerson)).status).toBe(200);

      const { tags } = await parseResponse<{ tags: TagShape[] }>(await listTags(mediaId));

      expect(tags.map(tag => ({ personId: tag.PersonId, isPrimary: tag.IsPersonPrimary })))
        .toEqual([
          { personId: primaryPerson, isPrimary: true },
          { personId: otherPerson, isPrimary: false },
        ]);
    });
  });

  describe('first profile picture from a tag (#922)', () => {
    const primaryOf = async (personId: number) => (await query(
      `SELECT "MediaId" FROM "MediaLink" WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 AND "IsPrimary" = 1`,
      [personId],
    )).rows;

    it('sets the primary for someone with none, and deleting that tag clears it again', async () => {
      const owner = await createPerson('Owner');
      const subject = await createPerson('Subject');
      const mediaId = await createMedia(owner);

      const { tag } = await parseResponse<{ tag: TagShape }>(await addTag(mediaId, subject));
      expect(await primaryOf(subject)).toEqual([{ MediaId: mediaId }]);

      const res = await DELETE_TAG(
        createRequest(`http://localhost:3000/api/media/${mediaId}/tags/${tag.Id}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: String(mediaId), tagId: String(tag.Id) }) },
      );
      expect(res.status).toBe(204);
      expect(await primaryOf(subject)).toEqual([]);
    });

    it('leaves an existing primary alone', async () => {
      const owner = await createPerson('Owner');
      const subject = await createPerson('Subject');
      const portrait = await createMedia(owner);
      const group = await createMedia(owner);
      expect((await setPrimary(portrait, subject)).status).toBe(200);

      await addTag(group, subject);

      expect(await primaryOf(subject)).toEqual([{ MediaId: portrait }]);
    });
  });

  describe('PUT (reassign tag)', () => {
    it('redraws coordinates without changing the tagged person or canonical primary', async () => {
      const owner = await createPerson('Owner');
      const tagged = await createPerson('Tagged');
      const mediaId = await createMedia(owner);
      const { tag } = await parseResponse<{ tag: TagShape }>(await addTag(mediaId, tagged));
      expect((await setPrimary(mediaId, tagged)).status).toBe(200);

      const res = await UPDATE_TAG(
        createRequest(`http://localhost:3000/api/media/${mediaId}/tags/${tag.Id}`, {
          method: 'PUT',
          body: { RegionX: 12, RegionY: 13, RegionW: 24, RegionH: 25 },
        }),
        { params: Promise.resolve({ id: String(mediaId), tagId: String(tag.Id) }) },
      );

      expect(res.status).toBe(200);
      const { tag: updated } = await parseResponse<{ tag: TagShape }>(res);
      expect(updated).toMatchObject({
        Id: tag.Id,
        PersonId: tagged,
        RegionX: 12,
        RegionY: 13,
        RegionW: 24,
        RegionH: 25,
        IsPersonPrimary: true,
      });
    });

    it.each([
      ['non-numeric width', { RegionW: 'NaN' }],
      ['infinite x', { RegionX: 'Infinity' }],
      ['negative infinite y', { RegionY: '-Infinity' }],
      ['infinite width', { RegionW: 'Infinity' }],
      ['zero width', { RegionW: 0 }],
      ['negative height', { RegionH: -1 }],
    ])('rejects %s without mutating the tag', async (_label, body) => {
      const owner = await createPerson('Owner');
      const tagged = await createPerson('Tagged');
      const mediaId = await createMedia(owner);
      const { tag } = await parseResponse<{ tag: TagShape }>(await addTag(mediaId, tagged));

      const res = await UPDATE_TAG(
        createRequest(`http://localhost:3000/api/media/${mediaId}/tags/${tag.Id}`, {
          method: 'PUT', body,
        }),
        { params: Promise.resolve({ id: String(mediaId), tagId: String(tag.Id) }) },
      );

      expect(res.status).toBe(400);
      const { tags } = await parseResponse<{ tags: TagShape[] }>(await listTags(mediaId));
      expect(tags[0]).toMatchObject(DEFAULT_REGION);
    });

    it('reassigns a tag to a different person', async () => {
      const subject = await createPerson('Alice');
      const bob = await createPerson('Bob');
      const carol = await createPerson('Carol');
      const mediaId = await createMedia(subject);
      const { tag } = await parseResponse<{ tag: TagShape }>(await addTag(mediaId, bob));

      const res = await UPDATE_TAG(
        createRequest(`http://localhost:3000/api/media/${mediaId}/tags/${tag.Id}`, {
          method: 'PUT',
          body: { PersonId: carol },
        }),
        { params: Promise.resolve({ id: String(mediaId), tagId: String(tag.Id) }) }
      );
      expect(res.status).toBe(200);
      const updated = await parseResponse<{ tag: TagShape }>(res);
      expect(updated.tag.PersonId).toBe(carol);
      expect(updated.tag.PersonFirstName).toBe('Carol');
    });

    it('returns a stable non-retryable 409 when reassignment would duplicate the person tag', async () => {
      const subject = await createPerson('Alice');
      const bob = await createPerson('Bob');
      const carol = await createPerson('Carol');
      const mediaId = await createMedia(subject);
      const { tag } = await parseResponse<{ tag: TagShape }>(await addTag(mediaId, bob));
      await addTag(mediaId, carol);

      const res = await UPDATE_TAG(
        createRequest(`http://localhost:3000/api/media/${mediaId}/tags/${tag.Id}`, {
          method: 'PUT',
          body: { PersonId: carol },
        }),
        { params: Promise.resolve({ id: String(mediaId), tagId: String(tag.Id) }) },
      );
      expect(res.status).toBe(409);
      expect(await parseResponse(res)).toEqual({
        error: 'This person is already tagged in this media',
        code: 'media_tag_conflict',
        retryable: false,
      });
    });

    it('returns 404 for a non-existent tag', async () => {
      const res = await UPDATE_TAG(
        createRequest('http://localhost:3000/api/media/1/tags/999999', {
          method: 'PUT',
          body: { RegionX: 50 },
        }),
        { params: Promise.resolve({ id: '1', tagId: '999999' }) }
      );
      expect(res.status).toBe(404);
    });

    it('returns 400 when the body has no recognised fields', async () => {
      const subject = await createPerson('Alice');
      const bob = await createPerson('Bob');
      const mediaId = await createMedia(subject);
      const { tag } = await parseResponse<{ tag: TagShape }>(await addTag(mediaId, bob));

      const res = await UPDATE_TAG(
        createRequest(`http://localhost:3000/api/media/${mediaId}/tags/${tag.Id}`, {
          method: 'PUT',
          body: {},
        }),
        { params: Promise.resolve({ id: String(mediaId), tagId: String(tag.Id) }) }
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when tagId does not belong to the given mediaId', async () => {
      const alice = await createPerson('Alice');
      const bob = await createPerson('Bob');
      const media1 = await createMedia(alice);
      const media2 = await createMedia(bob);
      const { tag } = await parseResponse<{ tag: TagShape }>(await addTag(media1, alice));

      // tag.Id belongs to media1 — using media2 in the URL should 404.
      const res = await UPDATE_TAG(
        createRequest(`http://localhost:3000/api/media/${media2}/tags/${tag.Id}`, {
          method: 'PUT',
          body: { PersonId: bob },
        }),
        { params: Promise.resolve({ id: String(media2), tagId: String(tag.Id) }) }
      );
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE (remove tag)', () => {
    it('removes a tag', async () => {
      const subject = await createPerson('Alice');
      const bob = await createPerson('Bob');
      const mediaId = await createMedia(subject);
      const { tag } = await parseResponse<{ tag: TagShape }>(await addTag(mediaId, bob));

      const res = await DELETE_TAG(
        createRequest(`http://localhost:3000/api/media/${mediaId}/tags/${tag.Id}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: String(mediaId), tagId: String(tag.Id) }) }
      );
      expect(res.status).toBe(204);

      const { tags } = await parseResponse<{ tags: TagShape[] }>(await listTags(mediaId));
      expect(tags).toHaveLength(0);
    });

    it('returns 404 deleting a non-existent tag', async () => {
      const res = await DELETE_TAG(
        createRequest('http://localhost:3000/api/media/1/tags/999999', { method: 'DELETE' }),
        { params: Promise.resolve({ id: '1', tagId: '999999' }) }
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 when tagId does not belong to the given mediaId', async () => {
      const alice = await createPerson('Alice');
      const bob = await createPerson('Bob');
      const media1 = await createMedia(alice);
      const media2 = await createMedia(bob);
      const { tag } = await parseResponse<{ tag: TagShape }>(await addTag(media1, alice));

      // tag.Id belongs to media1 — using media2 in the URL should 404.
      const res = await DELETE_TAG(
        createRequest(`http://localhost:3000/api/media/${media2}/tags/${tag.Id}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: String(media2), tagId: String(tag.Id) }) }
      );
      expect(res.status).toBe(404);
    });
  });

  describe('gallery (owned + tagged)', () => {
    it('uses canonical People links for ownership and person-specific primary state', async () => {
      const unlinkedOwner = await createPerson('UnlinkedOwner');
      const canonicalOwner = await createPerson('CanonicalOwner');
      const unlinkedMedia = await createMedia(unlinkedOwner);
      const canonicalMedia = await createMedia(unlinkedOwner);
      await query(
        `DELETE FROM "MediaLink" WHERE "MediaId" IN ($1, $2) AND "OwnerTable" = 'People'`,
        [unlinkedMedia, canonicalMedia],
      );
      await query(
        `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary")
         VALUES ($1, 'People', $2, 1)`,
        [canonicalMedia, canonicalOwner],
      );
      await query(
        `INSERT INTO "MediaTag" ("MediaId", "PersonId", "RegionX", "RegionY", "RegionW", "RegionH")
         VALUES ($1, $2, 10, 20, 30, 40)`,
        [canonicalMedia, canonicalOwner],
      );

      const { media } = await parseResponse<{ media: GalleryRow[] }>(await galleryFor(canonicalOwner));
      expect(media.map((row) => ({ id: row.Id, owned: row.IsOwned, primary: row.IsPersonPrimary })))
        .toEqual([{ id: canonicalMedia, owned: true, primary: true }]);
    });

    it('returns photos a person is tagged in alongside owned photos', async () => {
      const alice = await createPerson('Alice');
      const bob = await createPerson('Bob');
      const aliceMedia = await createMedia(alice);
      await addTag(aliceMedia, bob);

      // Tagging creates Bob's canonical People link, so link-backed ownership is true.
      const { media: bobGallery } = await parseResponse<{ media: GalleryRow[] }>(await galleryFor(bob));
      expect(bobGallery).toHaveLength(1);
      expect(bobGallery[0].Id).toBe(aliceMedia);
      expect(bobGallery[0].IsTaggedHere).toBe(true);
      expect(bobGallery[0].IsOwned).toBe(true);

      // Alice owns the photo.
      const { media: aliceGallery } = await parseResponse<{ media: GalleryRow[] }>(await galleryFor(alice));
      expect(aliceGallery).toHaveLength(1);
      expect(aliceGallery[0].IsOwned).toBe(true);
    });

    it('de-duplicates a photo a person both owns and is tagged in', async () => {
      const alice = await createPerson('Alice');
      const aliceMedia = await createMedia(alice);
      await addTag(aliceMedia, alice); // tagged in her own photo

      const { media } = await parseResponse<{ media: GalleryRow[] }>(await galleryFor(alice));
      expect(media).toHaveLength(1);
      expect(media[0].IsOwned).toBe(true);
      expect(media[0].IsTaggedHere).toBe(true);
    });
  });

  describe('setPrimaryForPerson via POST /api/media/[id]/primary', () => {
    it('sets a tagged photo as the tagged person\'s primary', async () => {
      const alice = await createPerson('Alice');
      const bob = await createPerson('Bob');
      const aliceMedia = await createMedia(alice);
      await addTag(aliceMedia, bob);

      const res = await setPrimary(aliceMedia, bob);
      expect(res.status).toBe(200);

      const { media } = await parseResponse<{ media: GalleryRow[] }>(await galleryFor(bob));
      expect(media[0].IsPersonPrimary).toBe(true);
    });

    it('removing a primary tag reselects the lowest eligible People link, including the same media', async () => {
      const alice = await createPerson('Alice');
      const bob = await createPerson('Bob');
      const selectedMedia = await createMedia(alice);
      const firstMedia = await createMedia(alice);
      await addTag(firstMedia, bob);
      const { tag } = await parseResponse<{ tag: TagShape }>(await addTag(selectedMedia, bob));

      const firstPrimaryResponse = await setPrimary(firstMedia, bob);
      const selectedPrimaryResponse = await setPrimary(selectedMedia, bob);
      expect(firstPrimaryResponse.status).toBe(200);
      expect(selectedPrimaryResponse.status).toBe(200);

      expect((await query(
        `SELECT "MediaId", "IsPrimary" FROM "MediaLink"
         WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 ORDER BY "MediaId"`,
        [bob],
      )).rows).toEqual([
        { MediaId: selectedMedia, IsPrimary: 1 },
        { MediaId: firstMedia, IsPrimary: 0 },
      ]);

      const res = await DELETE_TAG(
        createRequest(`http://localhost:3000/api/media/${selectedMedia}/tags/${tag.Id}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: String(selectedMedia), tagId: String(tag.Id) }) }
      );
      expect(res.status).toBe(204);

      expect((await query(
        `SELECT "MediaId" FROM "MediaLink"
         WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 AND "IsPrimary" = 1`,
        [bob],
      )).rows).toEqual([{ MediaId: selectedMedia }]);
      expect((await query(
        `SELECT "MediaId" FROM "MediaTag" WHERE "PersonId" = $1 ORDER BY "MediaId"`,
        [bob],
      )).rows).toEqual([{ MediaId: firstMedia }]);
    });

    it.skipIf(onPglite())('stabilizes tag reassignment through the People-first lock before deleting', async () => {
      const originalPerson = await createPerson('LockOriginal');
      const reassignedPerson = await createPerson('LockReassigned');
      const fallbackMedia = await createMedia(null);
      const selectedMedia = await createMedia(null);
      await addTag(fallbackMedia, originalPerson);
      const { tag } = await parseResponse<{ tag: TagShape }>(await addTag(selectedMedia, originalPerson));
      const treeId = (await query(`SELECT "TreeId" FROM "People" WHERE "Id" = $1`, [originalPerson])).rows[0].TreeId as number;

      for (const [mediaId, personId] of [
        [selectedMedia, originalPerson],
      ] as const) {
        const res = await setPrimary(mediaId, personId);
        expect(res.status).toBe(200);
      }

      const blocker = new Client({ connectionString: process.env.DATABASE_URL });
      await blocker.connect();
      let deletePromise: Promise<Response> | undefined;
      let updatePromise: Promise<Response> | undefined;
      let updateSettledWhilePersonLocked = false;
      let deleteReachedPersonLock = false;
      let activitySnapshot: Array<{ pid: number; wait_event_type: string | null; query: string; blockers: number[] }> = [];
      try {
        await blocker.query('BEGIN');
        const blockerPid = (await blocker.query(`SELECT pg_backend_pid()::int AS pid`)).rows[0].pid as number;
        await blocker.query(
          `SELECT "Id" FROM "People" WHERE "Id" = $1 AND "TreeId" = $2 FOR UPDATE`,
          [originalPerson, treeId],
        );

        deletePromise = DELETE_TAG(
          createRequest(`http://localhost:3000/api/media/${selectedMedia}/tags/${tag.Id}`, { method: 'DELETE' }),
          { params: Promise.resolve({ id: String(selectedMedia), tagId: String(tag.Id) }) },
        );

        for (let attempt = 0; attempt < 50; attempt += 1) {
          const waiting = await blocker.query(
            `SELECT pid, wait_event_type, query, pg_blocking_pids(pid) AS blockers
             FROM pg_stat_activity WHERE datname = current_database()`,
          );
          activitySnapshot = waiting.rows as typeof activitySnapshot;
          if (activitySnapshot.some(row => row.blockers.includes(blockerPid))) {
            deleteReachedPersonLock = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        if (deleteReachedPersonLock) {
          let updateSettled = false;
          updatePromise = UPDATE_TAG(
            createRequest(`http://localhost:3000/api/media/${selectedMedia}/tags/${tag.Id}`, {
              method: 'PUT', body: { PersonId: reassignedPerson },
            }),
            { params: Promise.resolve({ id: String(selectedMedia), tagId: String(tag.Id) }) },
          ).finally(() => { updateSettled = true; });
          for (let attempt = 0; attempt < 50; attempt += 1) {
            const waiting = await blocker.query(
              `SELECT pid, wait_event_type, query, pg_blocking_pids(pid) AS blockers
               FROM pg_stat_activity WHERE datname = current_database()`,
            );
            activitySnapshot = waiting.rows as typeof activitySnapshot;
            if (activitySnapshot.filter(row => row.blockers.includes(blockerPid)).length >= 2) break;
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          updateSettledWhilePersonLocked = updateSettled;
        }
      } finally {
        await blocker.query('COMMIT');
        await blocker.end();
      }

      const deleteResponse = await deletePromise!;
      const updateResponse = updatePromise ? await updatePromise : null;
      expect(deleteReachedPersonLock, JSON.stringify(activitySnapshot)).toBe(true);
      expect(updateSettledWhilePersonLocked).toBe(false);
      expect(deleteResponse.status).toBe(204);
      expect(updateResponse?.status).toBe(404);
      expect((await query(
        `SELECT "MediaId" FROM "MediaLink"
         WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 AND "IsPrimary" = 1`,
        [originalPerson],
      )).rows).toEqual([{ MediaId: fallbackMedia }]);
      expect((await query(
        `SELECT "MediaId" FROM "MediaLink"
         WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 AND "IsPrimary" = 1`,
        [reassignedPerson],
      )).rows).toEqual([]);
    });

    it.skipIf(onPglite())('completes competing primary-set and tag-delete transactions without a lock-order deadlock', async () => {
      const personId = await createPerson('DeadlockSubject');
      const fallbackMedia = await createMedia(null);
      const selectedMedia = await createMedia(null);
      // A primary before the tag, so the tag doesn't set one itself (#922) and the
      // delete takes the ordinary fallback path.
      await query(
        `INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "IsPrimary") VALUES ($1, 'People', $2, 1)`,
        [fallbackMedia, personId],
      );
      const { tag } = await parseResponse<{ tag: TagShape }>(await addTag(selectedMedia, personId));
      const treeId = (await query(`SELECT "TreeId" FROM "People" WHERE "Id" = $1`, [personId])).rows[0].TreeId as number;

      const lockKey = 810000000 + tag.Id;
      await query(`
        CREATE FUNCTION "pause_primary_link"() RETURNS trigger AS $$
        BEGIN
          IF NEW."MediaId" = ${selectedMedia} AND NEW."OwnerId" = ${personId} AND NEW."IsPrimary" = 1 THEN
            PERFORM pg_advisory_xact_lock(${lockKey});
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await query(`
        CREATE TRIGGER "pause_primary_link_trigger"
        BEFORE UPDATE ON "MediaLink" FOR EACH ROW EXECUTE FUNCTION "pause_primary_link"()
      `);

      const coordinator = new Client({ connectionString: process.env.DATABASE_URL });
      await coordinator.connect();
      let setPromise: Promise<unknown> | undefined;
      let deletePromise: Promise<Response> | undefined;
      try {
        await coordinator.query(`SELECT pg_advisory_lock($1)`, [lockKey]);
        const coordinatorPid = (await coordinator.query(`SELECT pg_backend_pid()::int AS pid`)).rows[0].pid as number;
        setPromise = setPrimaryMediaForPerson({
          mediaId: selectedMedia, personId, treeId, actingUserId: TEST_USER.id,
        });

        let setterPid: number | null = null;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const waiting = await coordinator.query(
            `SELECT pid::int FROM pg_stat_activity
             WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))
             LIMIT 1`,
            [coordinatorPid],
          );
          setterPid = (waiting.rows[0]?.pid as number | undefined) ?? null;
          if (setterPid != null) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(setterPid).not.toBeNull();

        deletePromise = DELETE_TAG(
          createRequest(`http://localhost:3000/api/media/${selectedMedia}/tags/${tag.Id}`, { method: 'DELETE' }),
          { params: Promise.resolve({ id: String(selectedMedia), tagId: String(tag.Id) }) },
        );
        let deleteWaitsForSetter = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const waiting = await coordinator.query(
            `SELECT 1 FROM pg_stat_activity
             WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))
             LIMIT 1`,
            [setterPid],
          );
          if (waiting.rows[0]) {
            deleteWaitsForSetter = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(deleteWaitsForSetter).toBe(true);
      } finally {
        await coordinator.query(`SELECT pg_advisory_unlock($1)`, [lockKey]);
        await coordinator.end();
      }

      const [setOutcome, deleteOutcome] = await Promise.allSettled([setPromise!, deletePromise!]);
      expect(
        setOutcome.status,
        setOutcome.status === 'rejected' ? String(setOutcome.reason) : undefined,
      ).toBe('fulfilled');
      expect(deleteOutcome.status).toBe('fulfilled');
      if (deleteOutcome.status === 'fulfilled') expect(deleteOutcome.value.status).toBe(204);
      expect((await query(
        `SELECT "MediaId" FROM "MediaLink"
         WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 AND "IsPrimary" = 1`,
        [personId],
      )).rows).toEqual([{ MediaId: fallbackMedia }]);
      expect((await query(`SELECT 1 FROM "MediaTag" WHERE "Id" = $1`, [tag.Id])).rows).toEqual([]);
    });

    it('rolls back canonical link, tag geometry, and audit state when primary-tag deletion fails', async () => {
      const alice = await createPerson('RollbackOwner');
      const bob = await createPerson('RollbackTag');
      const mediaId = await createMedia(alice);
      const { tag } = await parseResponse<{ tag: TagShape }>(await addTag(mediaId, bob));
      await setPrimary(mediaId, bob);
      const auditBefore = (await query(`SELECT COUNT(*)::int AS n FROM "AuditLog"`)).rows[0].n;
      await query(`
        CREATE FUNCTION "fail_primary_tag_delete"() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'forced tag deletion failure';
        END;
        $$ LANGUAGE plpgsql
      `);
      await query(`
        CREATE TRIGGER "fail_primary_tag_delete_trigger"
        BEFORE DELETE ON "MediaTag" FOR EACH ROW
        WHEN (OLD."Id" = ${tag.Id}) EXECUTE FUNCTION "fail_primary_tag_delete"()
      `);

      try {
        const res = await DELETE_TAG(
          createRequest(`http://localhost:3000/api/media/${mediaId}/tags/${tag.Id}`, { method: 'DELETE' }),
          { params: Promise.resolve({ id: String(mediaId), tagId: String(tag.Id) }) },
        );
        expect(res.status).toBe(500);
      } finally {
        await query(`DROP TRIGGER IF EXISTS "fail_primary_tag_delete_trigger" ON "MediaTag"`);
        await query(`DROP FUNCTION IF EXISTS "fail_primary_tag_delete"()`);
      }

      expect((await query(`SELECT "IsPrimary" FROM "MediaLink" WHERE "MediaId" = $1 AND "OwnerId" = $2`, [mediaId, bob])).rows)
        .toEqual([{ IsPrimary: 1 }]);
      expect((await query(`SELECT "PersonId", "RegionX" FROM "MediaTag" WHERE "Id" = $1`, [tag.Id])).rows)
        .toEqual([{ PersonId: bob, RegionX: DEFAULT_REGION.RegionX }]);
      expect((await query(`SELECT "Title" FROM "Media" WHERE "Id" = $1`, [mediaId])).rows)
        .toEqual([{ Title: 'A group photo' }]);
      expect((await query(`SELECT COUNT(*)::int AS n FROM "AuditLog"`)).rows[0].n).toBe(auditBefore);
    });
  });
});
