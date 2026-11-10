import { describe, it, expect, afterEach, vi } from 'vitest';
import { POST as CREATE_MEDIA } from '@/app/api/media/route';
import { DELETE as DELETE_MEDIA, GET as GET_MEDIA } from '@/app/api/media/[id]/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { GET as LIST_TAGS, POST as ADD_TAG } from '@/app/api/media/[id]/tags/route';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { query } from '@/lib/db/connection';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API DELETE /api/media/[id]', () => {
  afterEach(async () => { await cleanupTestData(); });

  async function createPerson(name: string): Promise<number> {
    const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST', body: { FirstName: name, LastName: 'Del' },
    }));
    return (await parseResponse<{ person: { Id: number } }>(res)).person.Id;
  }
  async function createMedia(personId: number | null): Promise<number> {
    const res = await CREATE_MEDIA(createRequest('http://localhost:3000/api/media', {
      method: 'POST', body: { PersonId: personId, Title: 'Doomed photo' },
    }));
    return (await parseResponse<{ media: { Id: number } }>(res)).media.Id;
  }
  const del = (id: number, treeId?: number) => DELETE_MEDIA(
    createRequest(`http://localhost:3000/api/media/${id}${treeId == null ? '' : `?treeId=${treeId}`}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: String(id) }) });
  const delSegment = (segment: string) => DELETE_MEDIA(
    createRequest(`http://localhost:3000/api/media/${segment}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: segment }) },
  );
  const get = (id: number) => GET_MEDIA(
    createRequest(`http://localhost:3000/api/media/${id}`),
    { params: Promise.resolve({ id: String(id) }) });

  it('hard-deletes a photo and cascades its face tags', async () => {
    const owner = await createPerson('Owner');
    const tagged = await createPerson('Tagged');
    const mediaId = await createMedia(owner);
    await ADD_TAG(createRequest(`http://localhost:3000/api/media/${mediaId}/tags`, {
      method: 'POST', body: { PersonId: tagged, RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20 },
    }), { params: Promise.resolve({ id: String(mediaId) }) });

    const res = await del(mediaId);
    expect(res.status).toBe(204);

    const after = await get(mediaId);
    expect(after.status).toBe(404);

    // Tags cascaded: listing tags on the deleted media returns none.
    const tagsRes = await LIST_TAGS(
      createRequest(`http://localhost:3000/api/media/${mediaId}/tags`),
      { params: Promise.resolve({ id: String(mediaId) }) });
    const { tags } = await parseResponse<{ tags: unknown[] }>(tagsRes);
    expect(tags).toHaveLength(0);
    void TEST_USER;
  });

  it('keeps deletion tree-scoped and records exactly one delete audit snapshot', async () => {
    const mediaId = await createMedia(null);
    const res = await del(mediaId);
    expect(res.status).toBe(204);
    expect((await query(
      `SELECT COUNT(*)::int AS n FROM "AuditLog" WHERE "Action" = 'delete' AND "EntityType" = 'media' AND "EntityId" = $1`,
      [mediaId],
    )).rows[0].n).toBe(1);

    const missing = await del(999999);
    expect(missing.status).toBe(404);
    expect((await query(
      `SELECT COUNT(*)::int AS n FROM "AuditLog" WHERE "Action" = 'delete' AND "EntityType" = 'media' AND "EntityId" = 999999`,
    )).rows[0].n).toBe(0);
  });

  it('does not delete a media row belonging to a different tree', async () => {
    // Establish the current/default tree before creating the second one: cleanup
    // removes all Trees after each test, so insertion order must be explicit.
    await createMedia(null);
    const firstTree = (await query(
      `SELECT "Id" FROM "Trees" WHERE "OwnerId" = $1 ORDER BY "Id" LIMIT 1`,
      [TEST_USER.id],
    )).rows[0] as { Id: number };
    const secondTree = (await query(
      `INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Second test tree') RETURNING "Id"`,
      [TEST_USER.id],
    )).rows[0] as { Id: number };
    const created = await CREATE_MEDIA(createRequest(
      `http://localhost:3000/api/media?treeId=${secondTree.Id}`,
      { method: 'POST', body: { PersonId: null, Title: 'Other-tree photo' } },
    ));
    const mediaId = (await parseResponse<{ media: { Id: number } }>(created)).media.Id;

    const res = await del(mediaId, firstTree.Id);
    expect(res.status).toBe(404);
    expect((await GET_MEDIA(
      createRequest(`http://localhost:3000/api/media/${mediaId}?treeId=${secondTree.Id}`),
      { params: Promise.resolve({ id: String(mediaId) }) },
    )).status).toBe(200);
  });

  it('returns 403 for a view-only shared tree before mutation', async () => {
    const mediaId = await createMedia(null);
    const tree = (await query(
      `SELECT "TreeId" AS "Id" FROM "Media" WHERE "Id" = $1`,
      [mediaId],
    )).rows[0] as { Id: number };
    await query(
      `INSERT INTO "TreeSharing" ("TreeId", "OwnerId", "SharedWithId", "Permission") VALUES ($1, $2, $3, 'view')`,
      [tree.Id, TEST_USER.id, TEST_USER_2.id],
  );
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);

    const res = await DELETE_MEDIA(
      createRequest(`http://localhost:3000/api/media/${mediaId}?treeId=${tree.Id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: String(mediaId) }) },
    );
    expect(res.status).toBe(403);
    expect((await query(`SELECT COUNT(*)::int AS n FROM "Media" WHERE "Id" = $1`, [mediaId])).rows[0].n).toBe(1);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const req = createRequest('http://localhost:3000/api/media/1', { method: 'DELETE' });
    const res = await DELETE_MEDIA(req, { params: Promise.resolve({ id: '1' }) });
    expect(res.status).toBe(401);
  });

  it.each(['1junk', '1.5', '0', '-1', '9007199254740992'])('rejects malformed single-delete segment %s without mutation', async (segment) => {
    const mediaId = await createMedia(null);
    const res = await delSegment(segment);
    expect(res.status).toBe(400);
    expect((await query('SELECT COUNT(*)::int AS n FROM "Media" WHERE "Id" = $1', [mediaId])).rows[0].n).toBe(1);
  });
});
