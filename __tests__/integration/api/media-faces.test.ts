import { describe, it, expect, afterEach, vi } from 'vitest';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as CREATE_MEDIA } from '@/app/api/media/route';
import { GET as FACES_GET } from '@/app/api/media/faces/route';
import { POST as FACES_CONFIRM } from '@/app/api/media/faces/confirm/route';
import { POST as FACES_REPOINT } from '@/app/api/media/faces/repoint/route';
import { POST as FACES_DISMISS } from '@/app/api/media/faces/dismiss/route';
import { POST as FACES_UNDO } from '@/app/api/media/faces/undo/route';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { query } from '@/lib/db/connection';
import { insertFaceCandidates, markDismissed } from '@/lib/db/queries/media-faces';
import type { FaceMatchKind } from '@/lib/db/schema';
import {
  captureFacesForMedia,
  listFaceQueueService, confirmFacesService, repointFacesService,
  dismissFacesService, undoFacesService, restoreFaceSuggestionsService, MAX_CANDIDATE_IDS,
} from '@/lib/services/media-faces';
import { buildJpegWithXmp, mwgPacket } from '../../fixtures/xmp/build-fixture';
import { getTagsForMedia, addMediaTag } from '@/lib/db/queries/media-tags';
import { setPrimaryMediaForPerson } from '@/lib/services/media';
import { resolveTreeScope } from '@/lib/db/queries/trees';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('face candidate queue', () => {
  afterEach(async () => {
    await query(`DROP TRIGGER IF EXISTS "fail_face_confirmation_trigger" ON "MediaFaceCandidate"`);
    await query(`DROP FUNCTION IF EXISTS "fail_face_confirmation"()`);
    await query(`DROP TRIGGER IF EXISTS "fail_face_undo_trigger" ON "MediaFaceCandidate"`);
    await query(`DROP FUNCTION IF EXISTS "fail_face_undo"()`);
    await cleanupTestData();
  });

  async function ctx() {
    const scope = await resolveTreeScope({ treeId: null, ownerId: null }, TEST_USER.id);
    return { requestedTreeId: scope.treeId, requestedOwnerId: null, currentUserId: TEST_USER.id, treeId: scope.treeId };
  }

  async function createPerson(first: string, last: string): Promise<number> {
    const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST', body: { FirstName: first, LastName: last },
    }));
    const { person } = await parseResponse<{ person: { Id: number } }>(res);
    return person.Id;
  }

  /** Same as `createPerson`, with the dates the queue's chips and lifespans need. */
  async function createDatedPerson(
    first: string, last: string, birth: string | null, death: string | null,
  ): Promise<number> {
    const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST', body: { FirstName: first, LastName: last, BirthDate: birth, DeathDate: death },
    }));
    const { person } = await parseResponse<{ person: { Id: number } }>(res);
    return person.Id;
  }

  async function createMedia(personId: number | null = null): Promise<number> {
    const res = await CREATE_MEDIA(createRequest('http://localhost:3000/api/media', {
      method: 'POST', body: { PersonId: personId, Title: 'Group photo' },
    }));
    const { media } = await parseResponse<{ media: { Id: number } }>(res);
    return media.Id;
  }

  async function seed(mediaId: number, treeId: number, name: string, personId: number | null, x = 10) {
    await insertFaceCandidates([{
      MediaId: mediaId, TreeId: treeId,
      RegionX: x, RegionY: 10, RegionW: 20, RegionH: 20,
      SourceName: name, SuggestedPersonId: personId, MatchKind: personId ? 'exact' : 'none',
    }]);
    const rows = await query(
      `SELECT "Id" FROM "MediaFaceCandidate" WHERE "MediaId" = $1 AND "RegionX" = $2`, [mediaId, x]);
    return (rows.rows[0] as { Id: number }).Id;
  }

  it('groups pending candidates by the name written in the photo', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const m1 = await createMedia();
    const m2 = await createMedia();
    await seed(m1, c.treeId, 'Ada Whitcombe', personId);
    await seed(m2, c.treeId, 'Ada Whitcombe', personId);

    const { groups, pendingTotal } = await listFaceQueueService(c);
    expect(pendingTotal).toBe(2);
    expect(groups).toHaveLength(1);
    expect(groups[0].sourceName).toBe('Ada Whitcombe');
    expect(groups[0].candidateCount).toBe(2);
  });

  it('mediaId keeps one photo’s candidates and leaves the totals tree-wide (#1268)', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const m1 = await createMedia();
    const m2 = await createMedia();
    const m3 = await createMedia();
    await seed(m1, c.treeId, 'Ada Whitcombe', personId);
    await seed(m2, c.treeId, 'Ada Whitcombe', personId);

    const one = await listFaceQueueService({ ...c, mediaId: m1 });
    expect(one.groups.flatMap((g) => g.candidates).map((r) => r.MediaId)).toEqual([m1]);
    expect(one.pendingTotal).toBe(2);

    const none = await listFaceQueueService({ ...c, mediaId: m3 });
    expect(none.groups).toEqual([]);
    expect(none.pendingTotal).toBe(2);

    const res = await FACES_GET(createRequest(`http://localhost:3000/api/media/faces?mediaId=${m2}`));
    const body = await parseResponse<{ groups: { candidates: { MediaId: number }[] }[] }>(res);
    expect(body.groups.flatMap((g) => g.candidates).map((r) => r.MediaId)).toEqual([m2]);
  });

  it('an ambiguous group reports the person count, not the face count', async () => {
    const c = await ctx();
    // Two real people share the exact same name, and three photos carry it —
    // ambiguousPersonCount must be 2 (people), not candidateCount's 3 (faces).
    await createPerson('Ada', 'Whitcombe');
    await createPerson('Ada', 'Whitcombe');
    const m1 = await createMedia();
    const m2 = await createMedia();
    const m3 = await createMedia();
    await seed(m1, c.treeId, 'Ada Whitcombe', null);
    await seed(m2, c.treeId, 'Ada Whitcombe', null);
    await seed(m3, c.treeId, 'Ada Whitcombe', null);
    // seed()'s default MatchKind is 'none' (personId null); force it to 'ambiguous'
    // to match what matchNameToPerson would actually have produced at capture time.
    await query(`UPDATE "MediaFaceCandidate" SET "MatchKind" = 'ambiguous' WHERE "TreeId" = $1`, [c.treeId]);

    const { groups } = await listFaceQueueService(c);
    expect(groups).toHaveLength(1);
    expect(groups[0].matchKind).toBe('ambiguous');
    expect(groups[0].candidateCount).toBe(3);
    expect(groups[0].ambiguousPersonCount).toBe(2);
  });

  it('stops calling a group ambiguous once only one of the duplicate people is left', async () => {
    const c = await ctx();
    // MatchKind is frozen on the row at capture time; the people it was derived
    // from are not. Deleting one of the two duplicates must not leave a card
    // that still says "ambiguous" while reporting "1 people share this name".
    const keep = await createPerson('Ada', 'Whitcombe');
    const remove = await createPerson('Ada', 'Whitcombe');
    const m1 = await createMedia();
    await seed(m1, c.treeId, 'Ada Whitcombe', null);
    await query(`UPDATE "MediaFaceCandidate" SET "MatchKind" = 'ambiguous' WHERE "TreeId" = $1`, [c.treeId]);
    await query(`DELETE FROM "People" WHERE "Id" = $1`, [remove]);

    const { groups } = await listFaceQueueService(c);
    expect(groups).toHaveLength(1);
    expect(groups[0].ambiguousPersonCount).toBeNull();   // never a nonsense 1 or 0
    expect(groups[0].matchKind).toBe('exact');           // re-derived from the live people
    expect(groups[0].suggestedPerson?.id).toBe(keep);
    expect(groups[0].suggestedPerson?.name).toBe('Ada Whitcombe');
    expect(groups[0].suggestedPerson).toMatchObject({ id: keep, name: 'Ada Whitcombe', mediaId: null });
  });

  it('drops the ambiguous verdict entirely when both duplicate people are gone', async () => {
    const c = await ctx();
    const a = await createPerson('Ada', 'Whitcombe');
    const b = await createPerson('Ada', 'Whitcombe');
    const m1 = await createMedia();
    await seed(m1, c.treeId, 'Ada Whitcombe', null);
    await query(`UPDATE "MediaFaceCandidate" SET "MatchKind" = 'ambiguous' WHERE "TreeId" = $1`, [c.treeId]);
    await query(`DELETE FROM "People" WHERE "Id" = ANY($1::int[])`, [[a, b]]);

    const { groups } = await listFaceQueueService(c);
    expect(groups[0].ambiguousPersonCount).toBeNull();
    expect(groups[0].matchKind).toBe('none');
    expect(groups[0].suggestedPerson).toBeNull();
  });

  it('exposes one candidate person per ambiguous match, with years to tell them apart', async () => {
    const c = await ctx();
    // The whole reason chips exist: two people, same name, distinguishable only
    // by their lifespans. Colour cannot carry this — the years must be text.
    const older = await createDatedPerson('Ada', 'Whitcombe', '1902-04-11', '1988-01-02');
    const younger = await createDatedPerson('Ada', 'Whitcombe', '1918-06-30', null);
    const m1 = await createMedia();
    await seed(m1, c.treeId, 'Ada Whitcombe', null);
    await query(`UPDATE "MediaFaceCandidate" SET "MatchKind" = 'ambiguous' WHERE "TreeId" = $1`, [c.treeId]);

    const { groups } = await listFaceQueueService(c);
    expect(groups[0].ambiguousPersonCount).toBe(2);
    expect(groups[0].ambiguousCandidates).toEqual([
      {
        id: older, name: 'Ada Whitcombe', birthYear: '1902', deathYear: '1988',
        // No primary photo on these fixtures, so the chip falls back to initials.
        sex: null, mediaId: null, focalX: null, focalY: null, focalRadius: null,
      },
      {
        id: younger, name: 'Ada Whitcombe', birthYear: '1918', deathYear: null,
        sex: null, mediaId: null, focalX: null, focalY: null, focalRadius: null,
      },
    ]);
  });

  it('keeps ambiguousCandidates and ambiguousPersonCount in agreement in every state', async () => {
    const c = await ctx();
    // One matched group and one ambiguous group in the same queue, so a single
    // pass covers both branches of the guard.
    await createDatedPerson('Rex', 'Pike', '1880', '1940');
    await createDatedPerson('Ada', 'Whitcombe', '1902', '1988');
    await createDatedPerson('Ada', 'Whitcombe', '1918', null);
    const m1 = await createMedia();
    const m2 = await createMedia();
    await seed(m1, c.treeId, 'Rex Pike', null);
    await seed(m2, c.treeId, 'Ada Whitcombe', null, 40);

    const { groups } = await listFaceQueueService(c);
    expect(groups.length).toBeGreaterThan(1);
    for (const group of groups) {
      if (group.ambiguousPersonCount == null) {
        expect(group.ambiguousCandidates).toEqual([]);
      } else {
        expect(group.ambiguousCandidates).toHaveLength(group.ambiguousPersonCount);
      }
    }
  });

  it('carries the suggested person lifespan for matched groups, and null when unknown', async () => {
    const c = await ctx();
    const dated = await createDatedPerson('Ada', 'Whitcombe', '1902-04-11', '1988-01-02');
    await createDatedPerson('Rex', 'Pike', null, null);
    const m1 = await createMedia();
    const m2 = await createMedia();
    await seed(m1, c.treeId, 'Ada Whitcombe', dated);
    await seed(m2, c.treeId, 'Rex Pike', null, 40);

    const { groups } = await listFaceQueueService(c);
    const ada = groups.find(g => g.sourceName === 'Ada Whitcombe');
    const rex = groups.find(g => g.sourceName === 'Rex Pike');
    expect(ada?.suggestedPerson?.birthYear).toBe('1902');
    expect(ada?.suggestedPerson?.deathYear).toBe('1988');
    // Matched, but no dates recorded: a lifespan must not be invented.
    expect(rex?.suggestedPerson?.name).toBe('Rex Pike');
    expect(rex?.suggestedPerson && [rex.suggestedPerson.birthYear, rex.suggestedPerson.deathYear]).toEqual([null, null]);
  });

  it('carries each face\'s photo date and how many people the photo shows (#1156)', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const other = await createPerson('Ben', 'Whitcombe');
    const m1 = await createMedia();
    await query(`UPDATE "Media" SET "Date" = 'ABT 1926' WHERE "Id" = $1`, [m1]);
    await addMediaTag({ MediaId: m1, PersonId: other, RegionX: 70, RegionY: 10, RegionW: 10, RegionH: 10 }, c.treeId);
    await seed(m1, c.treeId, 'Ada Whitcombe', personId);
    await seed(m1, c.treeId, 'Cora', null, 40);

    const { groups } = await listFaceQueueService(c);
    const ada = groups.find(g => g.sourceName === 'Ada Whitcombe')!;
    // One tag plus the two faces still waiting.
    expect(ada.candidates[0]).toMatchObject({ MediaDate: 'ABT 1926', MediaPeopleCount: 3 });
  });

  it('reports the resolved total alongside the pending total, for review progress', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const m1 = await createMedia();
    const m2 = await createMedia();
    const m3 = await createMedia();
    const keep = await seed(m1, c.treeId, 'Ada Whitcombe', personId);
    await seed(m2, c.treeId, 'Ada Whitcombe', personId, 40);
    const resolved = await seed(m3, c.treeId, 'Ada Whitcombe', personId, 70);
    await confirmFacesService({ ...c, candidateIds: [resolved], personId });

    const pending = await listFaceQueueService(c);
    expect(pending.pendingTotal).toBe(2);
    expect(pending.resolvedTotal).toBe(1);
    expect(keep).toBeGreaterThan(0);

    // The badge path must not start paying for a second count.
    const counted = await listFaceQueueService({ ...c, countOnly: true });
    expect(counted.pendingTotal).toBe(2);
    expect(counted.resolvedTotal).toBe(0);
    expect(counted.groups).toEqual([]);

    const resolvedCounted = await listFaceQueueService({ ...c, countOnly: true, resolved: true });
    expect(resolvedCounted).toEqual({ groups: [], pendingTotal: 0, resolvedTotal: 1 });
  });

  it('carries a candidate\'s primary photo so the chip shows a face, not initials', async () => {
    const c = await ctx();
    const withPhoto = await createDatedPerson('Ada', 'Whitcombe', '1902', '1988');
    await createDatedPerson('Ada', 'Whitcombe', '1918', null);
    // Owned by the person, which is what the primary service requires.
    const portrait = await createMedia(withPhoto);
    await setPrimaryMediaForPerson({ mediaId: portrait, personId: withPhoto, treeId: c.treeId, actingUserId: TEST_USER.id });
    const m1 = await createMedia();
    await seed(m1, c.treeId, 'Ada Whitcombe', null);
    await query(`UPDATE "MediaFaceCandidate" SET "MatchKind" = 'ambiguous' WHERE "TreeId" = $1`, [c.treeId]);

    const { groups } = await listFaceQueueService(c);
    const [first, second] = groups[0].ambiguousCandidates;
    // Same primary photo People and Families render — via the shared LATERAL,
    // not a second lookup.
    expect(first.mediaId).toBe(portrait);
    // The other has none, and must not borrow one.
    expect(second.mediaId).toBeNull();
  });

  it('hands back the prior suggestions on re-point so a mis-click can be undone', async () => {
    const c = await ctx();
    const ada = await createPerson('Ada', 'Whitcombe');
    const rex = await createPerson('Rex', 'Pike');
    const m1 = await createMedia();
    const id = await seed(m1, c.treeId, 'Ada Whitcombe', ada);

    const { previous } = await repointFacesService({ ...c, candidateIds: [id], personId: rex });
    expect(previous).toEqual([{ id, personId: ada, kind: 'exact' }]);

    // Re-pointing leaves the row PENDING, so undoFaces (resolved -> pending)
    // cannot reach it — this is why restore exists at all.
    const afterRepoint = await listFaceQueueService(c);
    expect(afterRepoint.groups[0].suggestedPerson?.id).toBe(rex);

    const { restored } = await restoreFaceSuggestionsService({ ...c, previous });
    expect(restored).toBe(1);

    const afterUndo = await listFaceQueueService(c);
    expect(afterUndo.groups[0].suggestedPerson?.id).toBe(ada);
    expect(afterUndo.pendingTotal).toBe(1);
  });

  it('restores a null suggestion, so undoing back to an unmatched group works', async () => {
    const c = await ctx();
    const rex = await createPerson('Rex', 'Pike');
    const m1 = await createMedia();
    const id = await seed(m1, c.treeId, 'Nobody Known', null);

    const { previous } = await repointFacesService({ ...c, candidateIds: [id], personId: rex });
    expect(previous).toEqual([{ id, personId: null, kind: 'none' }]);

    await restoreFaceSuggestionsService({ ...c, previous });
    const after = await listFaceQueueService(c);
    expect(after.groups[0].suggestedPerson).toBeNull();
    expect(after.groups[0].matchKind).toBe('none');
  });

  it('refuses to restore a suggestion pointing at another tree\'s person', async () => {
    const c = await ctx();
    const rex = await createPerson('Rex', 'Pike');
    const m1 = await createMedia();
    const id = await seed(m1, c.treeId, 'Ada Whitcombe', null);

    // The snapshot round-trips through the client, so it is fully untrusted:
    // without the tree check this would be a writable path for pointing one
    // tree's face at another tree's person.
    const foreign = await query(
      `INSERT INTO "People" ("UserId", "TreeId", "FirstName") VALUES ($1, 9999, 'Foreign') RETURNING "Id"`,
      [TEST_USER_2.id],
    );
    const foreignId = (foreign.rows[0] as { Id: number }).Id;

    await expect(restoreFaceSuggestionsService({
      ...c, previous: [{ id, personId: foreignId, kind: 'chosen' }],
    })).rejects.toThrow(/not found/i);

    const after = await listFaceQueueService(c);
    expect(after.groups[0].suggestedPerson?.id).not.toBe(foreignId);
    expect(rex).toBeGreaterThan(0);
  });

  it('rejects an unknown match kind rather than writing it', async () => {
    const c = await ctx();
    const m1 = await createMedia();
    const id = await seed(m1, c.treeId, 'Ada Whitcombe', null);

    await expect(restoreFaceSuggestionsService({
      ...c,
      previous: [{ id, personId: null, kind: 'totally-made-up' as FaceMatchKind }],
    })).rejects.toThrow(/match kind/i);
  });

  it('silently skips rows that stopped being pending before the undo landed', async () => {
    const c = await ctx();
    const ada = await createPerson('Ada', 'Whitcombe');
    const rex = await createPerson('Rex', 'Pike');
    const m1 = await createMedia();
    const id = await seed(m1, c.treeId, 'Ada Whitcombe', ada);

    const { previous } = await repointFacesService({ ...c, candidateIds: [id], personId: rex });
    // Confirmed in another tab between the toast appearing and Undo being hit.
    await confirmFacesService({ ...c, candidateIds: [id], personId: rex });

    // Must not resurrect a suggestion behind a decision the user already made.
    const { restored } = await restoreFaceSuggestionsService({ ...c, previous });
    expect(restored).toBe(0);
  });

  it('countOnly returns the pending total without building the groups', async () => {
    const c = await ctx();
    // Two same-named people make the group ambiguous, which is the expensive
    // path the badge must not pay for: the count-only call must skip it.
    await createPerson('Ada', 'Whitcombe');
    await createPerson('Ada', 'Whitcombe');
    const m1 = await createMedia();
    const m2 = await createMedia();
    await seed(m1, c.treeId, 'Ada Whitcombe', null);
    await seed(m2, c.treeId, 'Ada Whitcombe', null);
    await query(`UPDATE "MediaFaceCandidate" SET "MatchKind" = 'ambiguous' WHERE "TreeId" = $1`, [c.treeId]);

    const counted = await listFaceQueueService({ ...c, countOnly: true });
    expect(counted.pendingTotal).toBe(2);
    expect(counted.groups).toEqual([]);
    // Same number the full call reports, so the badge cannot disagree with the page.
    expect((await listFaceQueueService(c)).pendingTotal).toBe(2);
  });

  it('confirm creates a MediaTag and marks the candidate confirmed', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);

    const result = await confirmFacesService({ ...c, candidateIds: [id], personId });
    expect(result).toMatchObject({
      requestedCount: 1, confirmedCount: 1, skippedCount: 0, failedCount: 0,
      results: [{ candidateId: id, status: 'confirmed' }],
    });

    const tags = await getTagsForMedia(mediaId, c.treeId);
    expect(tags).toHaveLength(1);
    expect(tags[0].PersonId).toBe(personId);
    expect(tags[0].RegionX).toBeCloseTo(10, 3);

    const row = await query(`SELECT "Status", "ConfirmedTagId" FROM "MediaFaceCandidate" WHERE "Id" = $1`, [id]);
    expect((row.rows[0] as { Status: string }).Status).toBe('confirmed');
    expect((row.rows[0] as { ConfirmedTagId: number | null }).ConfirmedTagId).toBe(tags[0].Id);
  });

  it('returns ordered mixed outcomes and rolls back only the failed candidate', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const firstMedia = await createMedia();
    const failedMedia = await createMedia();
    const laterMedia = await createMedia();
    const resolvedMedia = await createMedia();
    const first = await seed(firstMedia, c.treeId, 'Ada Whitcombe', personId, 10);
    const failed = await seed(failedMedia, c.treeId, 'Ada Whitcombe', personId, 20);
    const later = await seed(laterMedia, c.treeId, 'Ada Whitcombe', personId, 30);
    const resolved = await seed(resolvedMedia, c.treeId, 'Ada Whitcombe', personId, 40);
    await confirmFacesService({ ...c, candidateIds: [resolved], personId });

    await query(`
      CREATE OR REPLACE FUNCTION "fail_face_confirmation"() RETURNS trigger AS $$
      BEGIN
        IF NEW."Id" = ${failed} AND NEW."Status" = 'confirmed' THEN
          RAISE EXCEPTION 'forced candidate confirmation failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await query(`
      CREATE TRIGGER "fail_face_confirmation_trigger"
      BEFORE UPDATE ON "MediaFaceCandidate"
      FOR EACH ROW EXECUTE FUNCTION "fail_face_confirmation"();
    `);

    const missing = 2_000_000_000;
    const result = await confirmFacesService({
      ...c,
      candidateIds: [first, failed, later, resolved, missing, first],
      personId,
    });

    expect(result.requestedCount).toBe(5);
    expect(result.confirmedCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.skippedCount).toBe(2);
    expect(result.results.map(item => ({ candidateId: item.candidateId, status: item.status }))).toEqual([
      { candidateId: first, status: 'confirmed' },
      { candidateId: failed, status: 'failed' },
      { candidateId: later, status: 'confirmed' },
      { candidateId: resolved, status: 'skipped' },
      { candidateId: missing, status: 'skipped' },
    ]);
    expect(result.results[3]).toMatchObject({ code: 'already_resolved' });
    expect(result.results[4]).toMatchObject({ code: 'not_found_or_inaccessible' });

    expect((await query(
      `SELECT "Status" FROM "MediaFaceCandidate" WHERE "Id" = $1`, [failed],
    )).rows).toEqual([{ Status: 'pending' }]);
    expect(await getTagsForMedia(failedMedia, c.treeId)).toHaveLength(0);
    expect(await getTagsForMedia(laterMedia, c.treeId)).toHaveLength(1);

    await query(`DROP TRIGGER "fail_face_confirmation_trigger" ON "MediaFaceCandidate"`);
    const retry = await confirmFacesService({ ...c, candidateIds: [failed], personId });
    expect(retry.results).toEqual([
      expect.objectContaining({ candidateId: failed, status: 'confirmed' }),
    ]);
    expect(await getTagsForMedia(failedMedia, c.treeId)).toHaveLength(1);
  });

  it('undo deletes the tag and returns the candidate to pending', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);
    await confirmFacesService({ ...c, candidateIds: [id], personId });

    const { restored } = await undoFacesService({ ...c, candidateIds: [id] });
    expect(restored).toBe(1);
    expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(0);

    const row = await query(
      `SELECT "Status", "SourceName", "RegionX", "ConfirmedTagId" FROM "MediaFaceCandidate" WHERE "Id" = $1`, [id]);
    const restoredRow = row.rows[0] as { Status: string; SourceName: string; RegionX: number; ConfirmedTagId: number | null };
    expect(restoredRow.Status).toBe('pending');
    expect(restoredRow.SourceName).toBe('Ada Whitcombe');
    expect(restoredRow.RegionX).toBeCloseTo(10, 3);
    expect(restoredRow.ConfirmedTagId).toBeNull();
  });

  it('undo rejects a contribute collaborator before deleting the confirmed tag', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);
    await confirmFacesService({ ...c, candidateIds: [id], personId });
    await query(
      `INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "TreeId", "Permission") VALUES ($1, $2, $3, 'contribute')`,
      [TEST_USER.id, TEST_USER_2.id, c.treeId],
    );

    await expect(undoFacesService({ ...c, currentUserId: TEST_USER_2.id, candidateIds: [id] }))
      .rejects.toThrow('delete records');
    expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(1);
    expect((await query(`SELECT "Status" FROM "MediaFaceCandidate" WHERE "Id" = $1`, [id])).rows)
      .toEqual([{ Status: 'confirmed' }]);
  });

  it('marks only still-pending candidates dismissed when the status changes first', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);
    await confirmFacesService({ ...c, candidateIds: [id], personId });

    await expect(markDismissed(id, 'not-a-face', c.treeId)).resolves.toBe(false);
    expect((await query(`SELECT "Status" FROM "MediaFaceCandidate" WHERE "Id" = $1`, [id])).rows)
      .toEqual([{ Status: 'confirmed' }]);
  });

  it('rolls back undo tag deletion when the candidate transition fails', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);
    await confirmFacesService({ ...c, candidateIds: [id], personId });
    await query(`
      CREATE OR REPLACE FUNCTION "fail_face_undo"() RETURNS trigger AS $$
      BEGIN
        IF OLD."Id" = ${id} AND NEW."Status" = 'pending' THEN
          RAISE EXCEPTION 'forced candidate undo failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await query(`
      CREATE TRIGGER "fail_face_undo_trigger"
      BEFORE UPDATE ON "MediaFaceCandidate"
      FOR EACH ROW EXECUTE FUNCTION "fail_face_undo"();
    `);

    await expect(undoFacesService({ ...c, candidateIds: [id] })).rejects.toThrow();
    expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(1);
    expect((await query(`SELECT "Status" FROM "MediaFaceCandidate" WHERE "Id" = $1`, [id])).rows)
      .toEqual([{ Status: 'confirmed' }]);
  });

  it('does not disturb a tag the user made by hand', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    // A hand-placed tag in a different position.
    const handMade = await addMediaTag({
      MediaId: mediaId, PersonId: personId,
      RegionX: 70, RegionY: 70, RegionW: 10, RegionH: 10,
    }, c.treeId, TEST_USER.id);

    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);
    await confirmFacesService({ ...c, candidateIds: [id], personId });

    const tags = await getTagsForMedia(mediaId, c.treeId);
    expect(tags).toHaveLength(1);
    expect(tags[0].Id).toBe(handMade.Id);
    expect(tags[0].RegionX).toBeCloseTo(70, 3); // NOT moved to the metadata region

    const row = await query(`SELECT "ConfirmedTagId" FROM "MediaFaceCandidate" WHERE "Id" = $1`, [id]);
    expect((row.rows[0] as { ConfirmedTagId: number | null }).ConfirmedTagId).toBeNull();
  });

  it('undo leaves a pre-existing tag alone', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    await addMediaTag({
      MediaId: mediaId, PersonId: personId,
      RegionX: 70, RegionY: 70, RegionW: 10, RegionH: 10,
    }, c.treeId, TEST_USER.id);
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);
    await confirmFacesService({ ...c, candidateIds: [id], personId });

    await undoFacesService({ ...c, candidateIds: [id] });
    expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(1);
  });

  it('withholds undo when the tag region has been changed since', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);
    await confirmFacesService({ ...c, candidateIds: [id], personId });

    const tags = await getTagsForMedia(mediaId, c.treeId);
    await query(`UPDATE "MediaTag" SET "RegionX" = 55 WHERE "Id" = $1`, [tags[0].Id]);

    const { restored, skipped } = await undoFacesService({ ...c, candidateIds: [id] });
    expect(restored).toBe(0);
    expect(skipped).toBe(1);
    expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(1); // still there
  });

  it('undo removes a primary tag through the atomic fallback operation', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const fallbackMediaId = await createMedia(personId);
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);
    await setPrimaryMediaForPerson({ mediaId: fallbackMediaId, personId, treeId: c.treeId, actingUserId: TEST_USER.id });
    await confirmFacesService({ ...c, candidateIds: [id], personId });

    const tags = await getTagsForMedia(mediaId, c.treeId);
    await setPrimaryMediaForPerson({ mediaId, personId, treeId: c.treeId, actingUserId: TEST_USER.id });

    const { restored, skipped } = await undoFacesService({ ...c, candidateIds: [id] });
    expect(restored).toBe(1);
    expect(skipped).toBe(0);
    expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(0);
    expect((await query(
      `SELECT "MediaId" FROM "MediaLink"
       WHERE "OwnerTable" = 'People' AND "OwnerId" = $1 AND "IsPrimary" = 1`,
      [personId],
    )).rows).toEqual([{ MediaId: fallbackMediaId }]);
    expect(tags).toHaveLength(1);
  });

  it('undo still restores the candidate when the tag is already gone', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);
    await confirmFacesService({ ...c, candidateIds: [id], personId });
    await query(`DELETE FROM "MediaTag" WHERE "MediaId" = $1`, [mediaId]);

    const { restored } = await undoFacesService({ ...c, candidateIds: [id] });
    expect(restored).toBe(1);
    const row = await query(`SELECT "Status" FROM "MediaFaceCandidate" WHERE "Id" = $1`, [id]);
    expect((row.rows[0] as { Status: string }).Status).toBe('pending');
  });

  it('dismiss removes the candidate from the queue and survives re-import', async () => {
    const c = await ctx();
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'R. Pike', null);
    await dismissFacesService({ ...c, candidateIds: [id], reason: 'not-a-face' });

    expect((await listFaceQueueService(c)).pendingTotal).toBe(0);

    // Re-importing the identical region must not resurrect it.
    await insertFaceCandidates([{
      MediaId: mediaId, TreeId: c.treeId,
      RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20,
      SourceName: 'R. Pike', SuggestedPersonId: null, MatchKind: 'none',
    }]);
    expect((await listFaceQueueService(c)).pendingTotal).toBe(0);
  });

  it('refuses a stranger with no share on the tree at all', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);

    // TEST_USER_2 has no TreeSharing row at all for TEST_USER's tree — this
    // must be denied at resolveTreeScope, before the write-permission check.
    const stranger = { ...c, currentUserId: TEST_USER_2.id };
    await expect(confirmFacesService({ ...stranger, candidateIds: [id], personId })).rejects.toThrow();
    await expect(dismissFacesService({ ...stranger, candidateIds: [id], reason: 'not-a-face' })).rejects.toThrow();
    await expect(undoFacesService({ ...stranger, candidateIds: [id] })).rejects.toThrow();

    expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(0);
  });

  it('refuses to confirm or dismiss on view-only permission', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);

    // Give TEST_USER_2 an actual 'view' share on TEST_USER's tree, so the
    // rejection below genuinely exercises the requireWrite ladder branch
    // rather than the "no share at all" AccessError from resolveTreeScope.
    await query(
      `INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "TreeId", "Permission") VALUES ($1, $2, $3, 'view')`,
      [TEST_USER.id, TEST_USER_2.id, c.treeId],
    );

    const viewer = { ...c, currentUserId: TEST_USER_2.id };
    await expect(confirmFacesService({ ...viewer, candidateIds: [id], personId }))
      .rejects.toThrow('You only have view permission for this tree');
    await expect(dismissFacesService({ ...viewer, candidateIds: [id], reason: 'not-a-face' }))
      .rejects.toThrow('You only have view permission for this tree');
    await expect(undoFacesService({ ...viewer, candidateIds: [id] }))
      .rejects.toThrow('You only have view permission for this tree');

    expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(0);
  });

  it('refuses candidate ids belonging to another tree', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);
    // Move the candidate to a tree the caller cannot reach.
    await query(`UPDATE "MediaFaceCandidate" SET "TreeId" = 999999 WHERE "Id" = $1`, [id]);

    const result = await confirmFacesService({ ...c, candidateIds: [id], personId });
    expect(result).toMatchObject({
      confirmedCount: 0,
      skippedCount: 1,
      failedCount: 0,
      results: [{ candidateId: id, status: 'skipped', code: 'not_found_or_inaccessible' }],
    });
    expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(0);
  });

  it('rejects confirm with a personId from outside the tree', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);

    await expect(confirmFacesService({ ...c, candidateIds: [id], personId: 999999 }))
      .rejects.toThrow('Person not found in this tree');

    expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(0);
    const row = await query(`SELECT "Status" FROM "MediaFaceCandidate" WHERE "Id" = $1`, [id]);
    expect((row.rows[0] as { Status: string }).Status).toBe('pending');
  });

  /** One face region, named, at a valid normalized MWG area. */
  function facePhoto(name: string): Uint8Array {
    return buildJpegWithXmp(mwgPacket([{ name, x: 0.2, y: 0.2, w: 0.2, h: 0.2 }]));
  }

  it('does not stage candidates for photos the sidecar already covers', async () => {
    const c = await ctx();
    const mediaId = await createMedia();
    // Simulate the sidecar having supplied a tag for this photo.
    const personId = await createPerson('Ada', 'Whitcombe');
    await addMediaTag({
      MediaId: mediaId, PersonId: personId,
      RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20,
    }, c.treeId, TEST_USER.id);

    await captureFacesForMedia(facePhoto('Ada Whitcombe'), mediaId, c.treeId, { skipIfTagged: true });
    expect((await listFaceQueueService(c)).pendingTotal).toBe(0);
  });

  it('still stages when the sidecar restored nothing for that photo', async () => {
    // Guards the test above from passing vacuously: same option, same fixture,
    // but no sidecar-restored tag, so the XMP region must still be captured.
    const c = await ctx();
    const mediaId = await createMedia();

    await captureFacesForMedia(facePhoto('Ada Whitcombe'), mediaId, c.treeId, { skipIfTagged: true });
    expect((await listFaceQueueService(c)).pendingTotal).toBe(1);
  });

  it('inserts a batch once and reports only the rows actually added on re-run', async () => {
    const c = await ctx();
    const mediaId = await createMedia();
    const rows = [10, 30, 50].map(x => ({
      MediaId: mediaId, TreeId: c.treeId,
      RegionX: x, RegionY: 10, RegionW: 20, RegionH: 20,
      SourceName: 'Ada Whitcombe', SuggestedPersonId: null, MatchKind: 'none' as const,
    }));
    expect(await insertFaceCandidates(rows)).toBe(3);
    // Re-import of the same photo: the UNIQUE constraint absorbs every row.
    expect(await insertFaceCandidates(rows)).toBe(0);
    // One new region among three known ones counts as exactly one.
    expect(await insertFaceCandidates([...rows, { ...rows[0], RegionX: 70 }])).toBe(1);
    expect((await listFaceQueueService(c)).pendingTotal).toBe(4);

    // Unnamed regions dedupe through the partial index, in the same batch shape.
    const unnamed = [{ ...rows[0], RegionX: 80, SourceName: null }];
    expect(await insertFaceCandidates(unnamed)).toBe(1);
    expect(await insertFaceCandidates(unnamed)).toBe(0);
  });

  // --- Re-derived matching (#487 review: spec §3) ---

  it('matches a candidate captured before its person existed, once they exist', async () => {
    const c = await ctx();
    const mediaId = await createMedia();
    // Imported 200 photos first, created the person afterwards — the ordinary
    // workflow. The stored verdict is 'none'; the live one is not.
    await captureFacesForMedia(facePhoto('Ada Whitcombe'), mediaId, c.treeId);
    let { groups } = await listFaceQueueService(c);
    expect(groups[0].matchKind).toBe('none');

    const personId = await createPerson('Ada', 'Whitcombe');
    ({ groups } = await listFaceQueueService(c));
    expect(groups[0].matchKind).toBe('exact');
    expect(groups[0].suggestedPerson?.id).toBe(personId);
    expect(groups[0].suggestedPerson?.name).toBe('Ada Whitcombe');
  });

  it('gives one group one verdict even when its rows were captured at different times', async () => {
    const c = await ctx();
    const before = await createMedia();
    await captureFacesForMedia(facePhoto('Ada Whitcombe'), before, c.treeId);   // -> 'none'
    const personId = await createPerson('Ada', 'Whitcombe');
    const after = await createMedia();
    await captureFacesForMedia(facePhoto('Ada Whitcombe'), after, c.treeId);    // -> 'exact'

    const { groups } = await listFaceQueueService(c);
    expect(groups).toHaveLength(1);
    expect(groups[0].candidateCount).toBe(2);
    expect(groups[0].matchKind).toBe('exact');           // not "whichever row sorted first"
    expect(groups[0].suggestedPerson?.id).toBe(personId);
  });

  // --- The spec's single bolded invariant (#487 review) ---

  it('an ambiguous group offers nothing to bulk-confirm', async () => {
    const c = await ctx();
    const ada1 = await createPerson('Ada', 'Whitcombe');
    await createPerson('Ada', 'Whitcombe');
    const m1 = await createMedia();
    const m2 = await createMedia();
    await captureFacesForMedia(facePhoto('Ada Whitcombe'), m1, c.treeId);
    await captureFacesForMedia(facePhoto('Ada Whitcombe'), m2, c.treeId);

    const { groups } = await listFaceQueueService(c);
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group.matchKind).toBe('ambiguous');
    // No suggestion means the card has no person to confirm the group AT, and
    // the page's "Confirm all matched" filter (exact/variant/chosen with a
    // person) cannot include it.
    expect(group.suggestedPerson).toBeNull();
    expect(group.ambiguousPersonCount).toBe(2);
    const bulkConfirmable = groups.filter(g =>
      (g.matchKind === 'exact' || g.matchKind === 'variant' || g.matchKind === 'chosen')
      && g.suggestedPerson != null);
    expect(bulkConfirmable).toEqual([]);

    // And picking a person for the group re-points it — it does NOT tag anyone.
    const ids = group.candidates.map(cd => cd.Id);
    const { repointed } = await repointFacesService({ ...c, candidateIds: ids, personId: ada1 });
    expect(repointed).toBe(2);
    expect(await getTagsForMedia(m1, c.treeId)).toHaveLength(0);
    expect(await getTagsForMedia(m2, c.treeId)).toHaveLength(0);

    const after = await listFaceQueueService(c);
    expect(after.pendingTotal).toBe(2);
    expect(after.groups[0].matchKind).toBe('chosen');
    expect(after.groups[0].suggestedPerson?.id).toBe(ada1);
  });

  it('a re-pointed face leaves its name group and keeps its region, siblings untouched', async () => {
    const c = await ctx();
    const ada = await createPerson('Ada', 'Whitcombe');
    const other = await createPerson('Ada', 'Pike');
    const m1 = await createMedia();
    const m2 = await createMedia();
    const keep = await seed(m1, c.treeId, 'Ada Whitcombe', ada);
    const split = await seed(m2, c.treeId, 'Ada Whitcombe', ada);

    await repointFacesService({ ...c, candidateIds: [split], personId: other });

    const { groups } = await listFaceQueueService(c);
    expect(groups).toHaveLength(2);
    const chosen = groups.find(g => g.matchKind === 'chosen');
    const rest = groups.find(g => g.matchKind === 'exact');
    expect(chosen?.candidates.map(cd => cd.Id)).toEqual([split]);
    expect(chosen?.suggestedPerson?.id).toBe(other);
    expect(chosen?.candidates[0].RegionX).toBeCloseTo(10, 3);   // region intact
    expect(rest?.candidates.map(cd => cd.Id)).toEqual([keep]);
    expect(rest?.suggestedPerson?.id).toBe(ada);
    expect(new Set(groups.map(g => g.groupKey)).size).toBe(2);  // distinct React keys
  });

  it('a re-point survives the review page re-running its matching', async () => {
    const c = await ctx();
    const ada = await createPerson('Ada', 'Whitcombe');
    const other = await createPerson('Rex', 'Pike');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', ada);

    await repointFacesService({ ...c, candidateIds: [id], personId: other });
    // Re-derivation must not quietly put the matcher's verdict back.
    const { groups } = await listFaceQueueService(c);
    expect(groups[0].matchKind).toBe('chosen');
    expect(groups[0].suggestedPerson?.id).toBe(other);
  });

  it('re-point refuses a view-only member, a foreign person, and a foreign candidate', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', null);

    await expect(repointFacesService({ ...c, candidateIds: [id], personId: 999999 }))
      .rejects.toThrow('Person not found in this tree');

    await query(
      `INSERT INTO "TreeSharing" ("OwnerId", "SharedWithId", "TreeId", "Permission") VALUES ($1, $2, $3, 'view')`,
      [TEST_USER.id, TEST_USER_2.id, c.treeId],
    );
    await expect(repointFacesService({ ...c, currentUserId: TEST_USER_2.id, candidateIds: [id], personId }))
      .rejects.toThrow('You only have view permission for this tree');

    await query(`UPDATE "MediaFaceCandidate" SET "TreeId" = 999999 WHERE "Id" = $1`, [id]);
    expect((await repointFacesService({ ...c, candidateIds: [id], personId })).repointed).toBe(0);
  });

  it('does not re-point a candidate that has already been resolved', async () => {
    const c = await ctx();
    const ada = await createPerson('Ada', 'Whitcombe');
    const other = await createPerson('Rex', 'Pike');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', ada);
    await confirmFacesService({ ...c, candidateIds: [id], personId: ada });

    expect((await repointFacesService({ ...c, candidateIds: [id], personId: other })).repointed).toBe(0);
    const row = await query(`SELECT "Status", "SuggestedPersonId" FROM "MediaFaceCandidate" WHERE "Id" = $1`, [id]);
    expect((row.rows[0] as { Status: string }).Status).toBe('confirmed');
    expect((row.rows[0] as { SuggestedPersonId: number }).SuggestedPersonId).toBe(ada);
  });

  it('will not dismiss a candidate that is already confirmed', async () => {
    const c = await ctx();
    const personId = await createPerson('Ada', 'Whitcombe');
    const mediaId = await createMedia();
    const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);
    await confirmFacesService({ ...c, candidateIds: [id], personId });

    // Dismissing a confirmed candidate would leave its MediaTag and
    // ConfirmedTagId behind — a state the spec's transition table has no row for.
    const { dismissed } = await dismissFacesService({ ...c, candidateIds: [id], reason: 'not-a-face' });
    expect(dismissed).toBe(0);
    const row = await query(
      `SELECT "Status", "DismissReason", "ConfirmedTagId" FROM "MediaFaceCandidate" WHERE "Id" = $1`, [id]);
    const after = row.rows[0] as { Status: string; DismissReason: string | null; ConfirmedTagId: number | null };
    expect(after.Status).toBe('confirmed');
    expect(after.DismissReason).toBeNull();
    expect(after.ConfirmedTagId).not.toBeNull();
    expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(1);
  });

  // --- HTTP layer: the hosted browser -> route -> service path ---

  describe('routes', () => {
    const url = (path: string) => `http://localhost:3000/api/media/faces${path}`;

    async function seeded() {
      const c = await ctx();
      const personId = await createPerson('Ada', 'Whitcombe');
      const mediaId = await createMedia();
      const id = await seed(mediaId, c.treeId, 'Ada Whitcombe', personId);
      return { c, personId, mediaId, id };
    }

    it('GET /api/media/faces returns the queue', async () => {
      const { id } = await seeded();
      const res = await FACES_GET(createRequest(url('')));
      expect(res.status).toBe(200);
      const body = await parseResponse<{ groups: { candidates: { Id: number }[] }[]; pendingTotal: number }>(res);
      expect(body.pendingTotal).toBe(1);
      expect(body.groups[0].candidates[0].Id).toBe(id);
    });

    it('POST /confirm tags the person', async () => {
      const { id, personId, mediaId, c } = await seeded();
      const res = await FACES_CONFIRM(createRequest(url('/confirm'), {
        method: 'POST', body: { candidateIds: [id], personId },
      }));
      expect(res.status).toBe(200);
      expect(await parseResponse(res)).toMatchObject({
        requestedCount: 1,
        confirmedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        results: [{ candidateId: id, status: 'confirmed' }],
      });
      expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(1);
    });

    it('POST /repoint re-points without tagging', async () => {
      const { id, personId, mediaId, c } = await seeded();
      const res = await FACES_REPOINT(createRequest(url('/repoint'), {
        method: 'POST', body: { candidateIds: [id], personId },
      }));
      expect(res.status).toBe(200);
      // `previous` carries the prior suggestion so the toast can offer Undo.
      expect(await parseResponse<{ repointed: number; personName: string; previous: unknown[] }>(res))
        .toEqual({ repointed: 1, personName: 'Ada Whitcombe', previous: [{ id, personId, kind: 'exact' }] });
      expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(0);
    });

    it.each([
      ['confirm', FACES_CONFIRM, { personId: 1 }],
      ['repoint', FACES_REPOINT, { personId: 1 }],
      ['dismiss', FACES_DISMISS, { reason: 'not-a-face' }],
      ['undo', FACES_UNDO, {}],
    ] as const)('rejects a mixed valid/malformed candidate request-wide for %s', async (_label, call, extra) => {
      const { id, personId, c, mediaId } = await seeded();
      const body = { candidateIds: [id, 'not-an-id'], ...extra, ...('personId' in extra ? { personId } : {}) };
      const res = await call(createRequest(url(`/${_label}`), { method: 'POST', body }));
      expect(res.status).toBe(400);
      expect((await query(`SELECT "Status" FROM "MediaFaceCandidate" WHERE "Id" = $1`, [id])).rows)
        .toEqual([{ Status: 'pending' }]);
      expect(await getTagsForMedia(mediaId, c.treeId)).toHaveLength(0);
    });

    it('POST /dismiss sets the candidate aside', async () => {
      const { id } = await seeded();
      const res = await FACES_DISMISS(createRequest(url('/dismiss'), {
        method: 'POST', body: { candidateIds: [id], reason: 'unidentified' },
      }));
      expect(res.status).toBe(200);
      expect(await parseResponse<{ dismissed: number }>(res)).toEqual({ dismissed: 1 });
    });

    it('POST /undo returns a confirmed candidate to the queue', async () => {
      const { id, personId } = await seeded();
      await FACES_CONFIRM(createRequest(url('/confirm'), { method: 'POST', body: { candidateIds: [id], personId } }));
      const res = await FACES_UNDO(createRequest(url('/undo'), { method: 'POST', body: { candidateIds: [id] } }));
      expect(res.status).toBe(200);
      expect(await parseResponse<{ restored: number; skipped: number }>(res)).toEqual({ restored: 1, skipped: 0 });
    });

    it('every face route is 401 without a session', async () => {
      const calls: [string, () => Promise<Response>][] = [
        ['GET', () => FACES_GET(createRequest(url('')))],
        ['confirm', () => FACES_CONFIRM(createRequest(url('/confirm'), { method: 'POST', body: { candidateIds: [1], personId: 1 } }))],
        ['repoint', () => FACES_REPOINT(createRequest(url('/repoint'), { method: 'POST', body: { candidateIds: [1], personId: 1 } }))],
        ['dismiss', () => FACES_DISMISS(createRequest(url('/dismiss'), { method: 'POST', body: { candidateIds: [1], reason: 'not-a-face' } }))],
        ['undo', () => FACES_UNDO(createRequest(url('/undo'), { method: 'POST', body: { candidateIds: [1] } }))],
      ];
      for (const [label, call] of calls) {
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
        const res = await call();
        expect(res.status, label).toBe(401);
      }
    });

    it('rejects an empty candidate list with 400 on every mutation', async () => {
      for (const call of [FACES_CONFIRM, FACES_REPOINT, FACES_DISMISS, FACES_UNDO]) {
        const res = await call(createRequest(url('/confirm'), {
          method: 'POST', body: { candidateIds: [], personId: 1, reason: 'not-a-face' },
        }));
        expect(res.status).toBe(400);
      }
    });

    it('rejects an over-long candidate list with 400 on every mutation', async () => {
      // Each mutation loops per candidate doing up to two writes, so an uncapped
      // id array is an unbounded serial write burst from one request (#487 review).
      const tooMany = Array.from({ length: MAX_CANDIDATE_IDS + 1 }, (_, i) => i + 1);
      for (const call of [FACES_CONFIRM, FACES_REPOINT, FACES_DISMISS, FACES_UNDO]) {
        const res = await call(createRequest(url('/confirm'), {
          method: 'POST', body: { candidateIds: tooMany, personId: 1, reason: 'not-a-face' },
        }));
        expect(res.status).toBe(400);
      }
      // The cap is a ceiling, not the working size: a full-length list still runs.
      const { id, personId } = await seeded();
      const ok = await FACES_CONFIRM(createRequest(url('/confirm'), {
        method: 'POST',
        body: { candidateIds: [id, ...Array.from({ length: MAX_CANDIDATE_IDS - 1 }, (_, i) => id + i + 1)], personId },
      }));
      expect(ok.status).toBe(200);
    });
  });
});
