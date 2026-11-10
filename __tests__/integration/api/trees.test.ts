import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET, POST } from '@/app/api/trees/route';
import { GET as GET_BY_ID, PATCH, DELETE } from '@/app/api/trees/[id]/route';
import { query } from '@/lib/db/connection';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import type { Tree } from '@/lib/db/schema';

const describeIf = hasTestDatabase() ? describe : describe.skip;

const CONFIRM = { 'X-Confirm-Delete-Tree': 'CONFIRM_DELETE_TREE' };

function idParams(id: number | string) {
  return { params: Promise.resolve({ id: String(id) }) };
}

async function listTrees(): Promise<Tree[]> {
  const res = await GET(createRequest('http://localhost:3000/api/trees'));
  expect(res.status).toBe(200);
  const { trees } = await parseResponse<{ trees: Tree[] }>(res);
  return trees;
}

async function createTree(name: string): Promise<Tree> {
  const res = await POST(createRequest('http://localhost:3000/api/trees', { method: 'POST', body: { name } }));
  expect(res.status).toBe(201);
  const { tree } = await parseResponse<{ tree: Tree }>(res);
  return tree;
}

describeIf('API /api/trees', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  it('GET lazily creates and returns the default tree', async () => {
    const trees = await listTrees();
    expect(trees.length).toBe(1);
    expect(trees[0].Name).toBe('My Tree');
    expect(trees[0].OwnerId).toBe(TEST_USER.id);
  });

  it('create + rename round-trip', async () => {
    const tree = await createTree('Maternal line');
    const renameRes = await PATCH(
      createRequest(`http://localhost:3000/api/trees/${tree.Id}`, { method: 'PATCH', body: { name: 'Maternal' } }),
      idParams(tree.Id)
    );
    expect(renameRes.status).toBe(200);
    const { tree: renamed } = await parseResponse<{ tree: Tree }>(renameRes);
    expect(renamed.Name).toBe('Maternal');
  });

  it('POST with an empty name → 400', async () => {
    const res = await POST(createRequest('http://localhost:3000/api/trees', { method: 'POST', body: { name: '   ' } }));
    expect(res.status).toBe(400);
  });

  it('GET by id returns owner permission', async () => {
    const tree = await createTree('Mine');
    const res = await GET_BY_ID(createRequest(`http://localhost:3000/api/trees/${tree.Id}`), idParams(tree.Id));
    expect(res.status).toBe(200);
    const info = await parseResponse<{ tree: Tree; permission: string }>(res);
    expect(info.permission).toBe('owner');
    expect(info.tree.Id).toBe(tree.Id);
  });

  it('DELETE with the confirm header wipes the tree and its rows', async () => {
    await listTrees(); // ensure the default tree exists first (it must survive)
    const doomed = await createTree('Doomed');
    await query(
      `INSERT INTO "People" ("UserId","TreeId","FirstName") VALUES ($1,$2,'Goner')`,
      [TEST_USER.id, doomed.Id]
    );

    const res = await DELETE(
      createRequest(`http://localhost:3000/api/trees/${doomed.Id}`, { method: 'DELETE', headers: CONFIRM }),
      idParams(doomed.Id)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleanupWarningCount: 0 });

    const trees = await listTrees();
    expect(trees.map((t) => t.Name)).toEqual(['My Tree']);
    const people = await query(
      `SELECT count(*)::int AS n FROM "People" WHERE "UserId" = $1 AND "TreeId" = $2`,
      [TEST_USER.id, doomed.Id]
    );
    expect((people.rows[0] as { n: number }).n).toBe(0);
  });

  it('DELETE without the confirm header → 400 and the tree survives', async () => {
    await listTrees();
    const tree = await createTree('Protected');
    const res = await DELETE(
      createRequest(`http://localhost:3000/api/trees/${tree.Id}`, { method: 'DELETE' }),
      idParams(tree.Id)
    );
    expect(res.status).toBe(400);
    const trees = await listTrees();
    expect(trees.some((t) => t.Id === tree.Id)).toBe(true);
  });

  it('deleting the ONLY tree → 400', async () => {
    const [only] = await listTrees();
    const res = await DELETE(
      createRequest(`http://localhost:3000/api/trees/${only.Id}`, { method: 'DELETE', headers: CONFIRM }),
      idParams(only.Id)
    );
    expect(res.status).toBe(400);
    const { error } = await parseResponse<{ error: string }>(res);
    expect(error).toMatch(/last tree/i);
  });

  it("rename/delete of another user's tree → 403", async () => {
    const tree = await createTree('Mine');

    const asUser2 = {
      id: TEST_USER_2.id,
      email: TEST_USER_2.email,
      name: TEST_USER_2.name,
      googleId: TEST_USER_2.googleId,
    };
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(asUser2 as never);
    const renameRes = await PATCH(
      createRequest(`http://localhost:3000/api/trees/${tree.Id}`, { method: 'PATCH', body: { name: 'Stolen' } }),
      idParams(tree.Id)
    );
    expect(renameRes.status).toBe(403);

    vi.mocked(getUserFromRequest).mockResolvedValueOnce(asUser2 as never);
    const deleteRes = await DELETE(
      createRequest(`http://localhost:3000/api/trees/${tree.Id}`, { method: 'DELETE', headers: CONFIRM }),
      idParams(tree.Id)
    );
    expect(deleteRes.status).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null as never);
    const res = await GET(createRequest('http://localhost:3000/api/trees'));
    expect(res.status).toBe(401);
  });

  it('unauthenticated DELETE /api/trees/[id] → 401', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null as never);
    const res = await DELETE(
      createRequest('http://localhost:3000/api/trees/1', { method: 'DELETE', headers: CONFIRM }),
      idParams(1),
    );
    expect(res.status).toBe(401);
  });
});
