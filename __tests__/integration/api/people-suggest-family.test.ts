import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as SUGGEST } from '@/app/api/people/suggest-family/route';
import { POST as POST_TREE } from '@/app/api/trees/route';
import { POST as POST_PERSON } from '@/app/api/people/route';
import { POST as POST_FAMILY } from '@/app/api/families/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import type { Tree } from '@/lib/db/schema';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface Suggestion {
  role: string;
  familyId: number;
  score: number;
}

/**
 * Coverage for GET /api/people/suggest-family — the family-suggestion route was
 * previously exercised only indirectly. Covers the service's early-return
 * guards, and (the important part) that suggestions are tree-scoped: a matching
 * family in tree B is never suggested to a request scoped to tree A.
 */
describeIf('API GET /api/people/suggest-family', () => {
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

  /** Create a family in `treeId` whose partner carries `lastName` (a suggestion candidate). */
  async function seedFamilyWithPartner(treeId: number, lastName: string): Promise<number> {
    const personRes = await POST_PERSON(
      createRequest(`http://localhost:3000/api/people?treeId=${treeId}`, {
        method: 'POST',
        body: { FirstName: 'Parent', LastName: lastName },
      })
    );
    expect(personRes.status).toBe(201);
    const { person } = await parseResponse<{ person: { Id: number } }>(personRes);

    const famRes = await POST_FAMILY(
      createRequest(`http://localhost:3000/api/families?treeId=${treeId}`, {
        method: 'POST',
        body: { Partner1Id: person.Id },
      })
    );
    expect(famRes.status).toBe(201);
    const { family } = await parseResponse<{ family: { Id: number } }>(famRes);
    return family.Id;
  }

  function suggest(treeId: number, q: Record<string, string>) {
    const params = new URLSearchParams({ treeId: String(treeId), ...q });
    return SUGGEST(createRequest(`http://localhost:3000/api/people/suggest-family?${params}`));
  }

  it('suggests a same-tree family whose partner shares the surname', async () => {
    const tree = await createTree('Suggest Tree');
    const familyId = await seedFamilyWithPartner(tree.Id, 'Wibbleton');

    const res = await suggest(tree.Id, { lastName: 'Wibbleton', birthDate: '1880' });
    expect(res.status).toBe(200);
    const { suggestions } = await parseResponse<{ suggestions: Suggestion[] }>(res);
    expect(suggestions.some((s) => s.familyId === familyId)).toBe(true);
  });

  it('does NOT suggest a matching family that lives in another tree (scope isolation)', async () => {
    const A = await createTree('Suggest Tree A');
    const B = await createTree('Suggest Tree B');
    const familyInB = await seedFamilyWithPartner(B.Id, 'Wibbleton');

    // Same surname query, but scoped to tree A — tree B's family must not leak.
    const resA = await suggest(A.Id, { lastName: 'Wibbleton', birthDate: '1880' });
    expect(resA.status).toBe(200);
    const { suggestions: sA } = await parseResponse<{ suggestions: Suggestion[] }>(resA);
    expect(sA.some((s) => s.familyId === familyInB)).toBe(false);

    // Sanity: under tree B scope the very same family IS suggested.
    const resB = await suggest(B.Id, { lastName: 'Wibbleton', birthDate: '1880' });
    const { suggestions: sB } = await parseResponse<{ suggestions: Suggestion[] }>(resB);
    expect(sB.some((s) => s.familyId === familyInB)).toBe(true);
  });

  it('returns an empty list when the surname is missing (service guard)', async () => {
    const tree = await createTree('Suggest Guard Tree');
    const res = await suggest(tree.Id, { lastName: '', birthDate: '1880' });
    expect(res.status).toBe(200);
    const { suggestions } = await parseResponse<{ suggestions: Suggestion[] }>(res);
    expect(suggestions).toEqual([]);
  });

  it('returns an empty list when the birth date has no parseable year', async () => {
    const tree = await createTree('Suggest NoYear Tree');
    await seedFamilyWithPartner(tree.Id, 'Wibbleton');
    const res = await suggest(tree.Id, { lastName: 'Wibbleton', birthDate: 'sometime' });
    expect(res.status).toBe(200);
    const { suggestions } = await parseResponse<{ suggestions: Suggestion[] }>(res);
    expect(suggestions).toEqual([]);
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const res = await SUGGEST(
      createRequest('http://localhost:3000/api/people/suggest-family?lastName=X&birthDate=1900')
    );
    expect(res.status).toBe(401);
  });
});
