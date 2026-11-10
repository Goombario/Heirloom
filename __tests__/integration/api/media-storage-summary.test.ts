import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as GET_STORAGE } from '@/app/api/media/storage/route';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { query } from '@/lib/db/connection';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;

async function insertMedia(treeId: number, ownerId: number, title: string, fileSize: number) {
  await query(
    `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format", "ContentType", "FileSize")
     VALUES ($1, $2, $3, NULL, 'JPEG', 'image/jpeg', $4)`,
    [ownerId, treeId, title, fileSize],
  );
}

describeIf('GET /api/media/storage', () => {
  afterEach(async () => {
    await cleanupTestData();
    vi.unstubAllEnvs();
  });

  it('requires authentication', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);

    const response = await GET_STORAGE(createRequest('http://localhost:3000/api/media/storage'));

    expect(response.status).toBe(401);
  });

  it('returns the default quota and only sums the requested tree, including placeholder rows safely', async () => {
    const treeId = await resolveDefaultTree(TEST_USER.id);
    await insertMedia(treeId, TEST_USER.id, 'fictional large photo', 2048);
    await insertMedia(treeId, TEST_USER.id, 'fictional placeholder', 0);

    const otherTree = (await query(
      `INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Fictional second tree') RETURNING "Id"`,
      [TEST_USER.id],
    )).rows[0] as { Id: number };
    await insertMedia(otherTree.Id, TEST_USER.id, 'other tree photo', 999999);

    const response = await GET_STORAGE(createRequest(`http://localhost:3000/api/media/storage?treeId=${treeId}`));
    expect(response.status).toBe(200);
    const data = await parseResponse<{
      usedBytes: number;
      limitBytes: number;
      remainingBytes: number;
      percentUsed: number;
      quotaMode: string;
    }>(response);

    expect(data.usedBytes).toBe(2048);
    expect(data.limitBytes).toBe(100 * 1024 * 1024);
    expect(data.remainingBytes).toBe(100 * 1024 * 1024 - 2048);
    expect(data.percentUsed).toBe((2048 / (100 * 1024 * 1024)) * 100);
    expect(data.quotaMode).toBe('tree');
  });

  it('allows a view-only member to read the shared tree summary and rejects an unrelated tree', async () => {
    const treeId = await resolveDefaultTree(TEST_USER.id);
    await insertMedia(treeId, TEST_USER.id, 'shared fictional photo', 512);
    await query(
      `INSERT INTO "TreeSharing" ("TreeId", "OwnerId", "SharedWithId", "Permission") VALUES ($1, $2, $3, 'view')`,
      [treeId, TEST_USER.id, TEST_USER_2.id],
    );

    vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
    const sharedResponse = await GET_STORAGE(createRequest(`http://localhost:3000/api/media/storage?treeId=${treeId}`));
    expect(sharedResponse.status).toBe(200);
    await expect(sharedResponse.json()).resolves.toMatchObject({ usedBytes: 512, quotaMode: 'tree' });

    const foreignTree = (await query(
      `INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Fictional private tree') RETURNING "Id"`,
      [TEST_USER_2.id],
    )).rows[0] as { Id: number };
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER);
    const deniedResponse = await GET_STORAGE(createRequest(`http://localhost:3000/api/media/storage?treeId=${foreignTree.Id}`));
    expect(deniedResponse.status).toBe(403);
  });
});
