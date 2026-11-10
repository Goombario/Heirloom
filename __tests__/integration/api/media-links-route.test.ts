import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { POST as LINK_MEDIA } from '@/app/api/media/[id]/links/route';
import { POST as CREATE_MEDIA } from '@/app/api/media/route';
import { POST as POST_TREE } from '@/app/api/trees/route';
import { POST as POST_FAMILY } from '@/app/api/families/route';
import { query } from '@/lib/db/connection';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import type { Tree } from '@/lib/db/schema';

const describeIf = hasTestDatabase() ? describe : describe.skip;

function idParams(id: number | string) {
  return { params: Promise.resolve({ id: String(id) }) };
}

/**
 * Coverage for POST /api/media/[id]/links — attach an existing Media row to an
 * owner record (Family/Source/…) via MediaLink. Previously untested at the
 * route level. Covers the 400 input-validation ladder, the cross-tree IDOR
 * guard (media in tree A cannot be linked to an owner living in tree B), auth,
 * and the happy path (row actually written to MediaLink).
 */
describeIf('API POST /api/media/[id]/links', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  async function createTree(name: string): Promise<Tree> {
    const res = await POST_TREE(
      createRequest('http://localhost:3000/api/trees', { method: 'POST', body: { name } })
    );
    expect(res.status).toBe(201);
    const { tree } = await parseResponse<{ tree: Tree }>(res);
    return tree;
  }

  async function createMedia(treeId?: number): Promise<number> {
    const url = treeId
      ? `http://localhost:3000/api/media?treeId=${treeId}`
      : 'http://localhost:3000/api/media';
    const res = await CREATE_MEDIA(createRequest(url, { method: 'POST', body: { Title: 'Linkable photo' } }));
    expect(res.status).toBe(201);
    const { media } = await parseResponse<{ media: { Id: number } }>(res);
    return media.Id;
  }

  async function createFamily(treeId?: number): Promise<number> {
    const url = treeId
      ? `http://localhost:3000/api/families?treeId=${treeId}`
      : 'http://localhost:3000/api/families';
    const res = await POST_FAMILY(createRequest(url, { method: 'POST', body: {} }));
    expect(res.status).toBe(201);
    const { family } = await parseResponse<{ family: { Id: number } }>(res);
    return family.Id;
  }

  function linkReq(mediaId: number | string, body: unknown, treeId?: number) {
    const url = treeId
      ? `http://localhost:3000/api/media/${mediaId}/links?treeId=${treeId}`
      : `http://localhost:3000/api/media/${mediaId}/links`;
    return LINK_MEDIA(createRequest(url, { method: 'POST', body }), idParams(mediaId));
  }

  it('links an existing media to a same-tree owner and persists the MediaLink row', async () => {
    const mediaId = await createMedia();
    const familyId = await createFamily();

    const res = await linkReq(mediaId, { ownerTable: 'Families', recordId: familyId });
    expect(res.status).toBe(201);
    const { success } = await parseResponse<{ success: boolean }>(res);
    expect(success).toBe(true);

    const row = await query(
      `SELECT 1 FROM "MediaLink" WHERE "MediaId" = $1 AND "OwnerTable" = 'Families' AND "OwnerId" = $2`,
      [mediaId, familyId]
    );
    expect(row.rowCount).toBe(1);
  });

  it('returns 400 for an invalid media id in the path', async () => {
    const res = await linkReq('abc', { ownerTable: 'Families', recordId: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unrecognized ownerTable', async () => {
    const mediaId = await createMedia();
    const res = await linkReq(mediaId, { ownerTable: 'DROP TABLE', recordId: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for a missing/invalid recordId', async () => {
    const mediaId = await createMedia();
    const res = await linkReq(mediaId, { ownerTable: 'Families', recordId: 'nope' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the owner record lives in another tree (cross-tree IDOR guard)', async () => {
    const treeA = await createTree('Links Tree A');
    const treeB = await createTree('Links Tree B');
    const mediaInA = await createMedia(treeA.Id);
    const familyInB = await createFamily(treeB.Id);

    // Request scoped to tree A; the tree-B family is not visible there.
    const res = await linkReq(mediaInA, { ownerTable: 'Families', recordId: familyInB }, treeA.Id);
    expect(res.status).toBe(404);

    // And no link was written.
    const row = await query(
      `SELECT 1 FROM "MediaLink" WHERE "MediaId" = $1 AND "OwnerId" = $2`,
      [mediaInA, familyInB]
    );
    expect(row.rowCount).toBe(0);
  });

  it('returns 404 when the media id lives in another tree', async () => {
    const treeA = await createTree('Links Tree A2');
    const treeB = await createTree('Links Tree B2');
    const mediaInB = await createMedia(treeB.Id);
    const familyInA = await createFamily(treeA.Id);

    // Request scoped to tree A; the media id belongs to tree B → not found here.
    const res = await linkReq(mediaInB, { ownerTable: 'Families', recordId: familyInA }, treeA.Id);
    expect(res.status).toBe(404);
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const res = await linkReq(1, { ownerTable: 'Families', recordId: 1 });
    expect(res.status).toBe(401);
  });
});
