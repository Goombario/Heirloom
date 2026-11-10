import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/tree/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as CREATE_FAMILY } from '@/app/api/families/route';
import { POST as ADD_CHILD } from '@/app/api/families/[id]/children/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API /api/tree', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  async function createPerson(firstName: string, lastName: string) {
    const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST',
      body: { FirstName: firstName, LastName: lastName },
    }));
    return (await parseResponse<{ person: { Id: number } }>(res)).person;
  }

  it('returns 404 when no people exist', async () => {
    const req = createRequest('http://localhost:3000/api/tree');
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it('returns tree with a single person', async () => {
    await createPerson('Lonely', 'Root');

    const req = createRequest('http://localhost:3000/api/tree');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await parseResponse<{ tree: { name: string }; roots: { id: number }[] }>(res);
    expect(data.tree.name).toBe('Lonely Root');
    expect(data.roots).toHaveLength(1);
  });

  it('builds descendants tree', async () => {
    const parent = await createPerson('Top', 'Node');
    const child = await createPerson('Bottom', 'Node');

    const famRes = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
      method: 'POST',
      body: { HusbandId: parent.Id },
    }));
    const { family } = await parseResponse<{ family: { Id: number } }>(famRes);

    await ADD_CHILD(
      createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
        method: 'POST',
        body: { childId: child.Id },
      }),
      { params: Promise.resolve({ id: String(family.Id) }) }
    );

    const req = createRequest(`http://localhost:3000/api/tree?id=${parent.Id}&mode=descendants`);
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await parseResponse<{ tree: { name: string; children?: { name: string }[] } }>(res);
    expect(data.tree.name).toBe('Top Node');
    expect(data.tree.children).toHaveLength(1);
    expect(data.tree.children![0].name).toBe('Bottom Node');
  });

  it('returns "Xmo" age string for infant born less than 2 years ago', async () => {
    const now = new Date();
    // Born 6 months ago — always returns a month-string, never a year integer
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    const birthDate = sixMonthsAgo.toISOString().slice(0, 10);

    const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST',
      body: { FirstName: 'Baby', LastName: 'Infant', BirthDate: birthDate },
    }));
    const { person } = await parseResponse<{ person: { Id: number } }>(res);

    const treeRes = await GET(createRequest(`http://localhost:3000/api/tree?id=${person.Id}`));
    expect(treeRes.status).toBe(200);

    const data = await parseResponse<{ tree: { age?: string | number } }>(treeRes);
    expect(typeof data.tree.age).toBe('string');
    expect((data.tree.age as string).endsWith('mo')).toBe(true);
  });

  it('builds ancestors tree', async () => {
    const parent = await createPerson('Ancestor', 'One');
    const child = await createPerson('Descendant', 'One');

    const famRes = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
      method: 'POST',
      body: { HusbandId: parent.Id },
    }));
    const { family } = await parseResponse<{ family: { Id: number } }>(famRes);

    await ADD_CHILD(
      createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
        method: 'POST',
        body: { childId: child.Id },
      }),
      { params: Promise.resolve({ id: String(family.Id) }) }
    );

    const req = createRequest(`http://localhost:3000/api/tree?id=${child.Id}&mode=ancestors`);
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await parseResponse<{ tree: { name: string; children?: { name: string }[] } }>(res);
    expect(data.tree.name).toBe('Descendant One');
    // In ancestor mode, "children" are actually ancestors
    expect(data.tree.children).toHaveLength(1);
    expect(data.tree.children![0].name).toBe('Ancestor One');
  });

  it('populates siblings in ancestor mode when root has a sibling', async () => {
    const mother = await createPerson('Martha', 'Elder');
    const root = await createPerson('Leaf', 'Child');
    const sibling = await createPerson('Sibling', 'Child');

    // Create family with mother as wife, then add both children
    const famRes = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
      method: 'POST',
      body: { WifeId: mother.Id },
    }));
    const { family } = await parseResponse<{ family: { Id: number } }>(famRes);

    await ADD_CHILD(
      createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
        method: 'POST',
        body: { childId: root.Id },
      }),
      { params: Promise.resolve({ id: String(family.Id) }) }
    );
    await ADD_CHILD(
      createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
        method: 'POST',
        body: { childId: sibling.Id },
      }),
      { params: Promise.resolve({ id: String(family.Id) }) }
    );

    const res = await GET(createRequest(`http://localhost:3000/api/tree?id=${root.Id}&mode=ancestors`));
    expect(res.status).toBe(200);

    const data = await parseResponse<{
      tree: {
        name: string;
        siblings?: { id: number; name: string; connectingParentId: number }[];
      }
    }>(res);

    expect(data.tree.siblings).toBeDefined();
    expect(data.tree.siblings).toHaveLength(1);
    expect(data.tree.siblings![0].name).toBe('Sibling Child');
    // connectingParentId should be the mother (WifeId preferred over HusbandId)
    expect(data.tree.siblings![0].connectingParentId).toBe(mother.Id);
  });

  it('does not include siblings key when root has no siblings', async () => {
    const parent = await createPerson('Solo', 'Parent');
    const onlyChild = await createPerson('Only', 'Child');

    const famRes = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
      method: 'POST',
      body: { HusbandId: parent.Id },
    }));
    const { family } = await parseResponse<{ family: { Id: number } }>(famRes);

    await ADD_CHILD(
      createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
        method: 'POST',
        body: { childId: onlyChild.Id },
      }),
      { params: Promise.resolve({ id: String(family.Id) }) }
    );

    const res = await GET(createRequest(`http://localhost:3000/api/tree?id=${onlyChild.Id}&mode=ancestors`));
    expect(res.status).toBe(200);

    const data = await parseResponse<{ tree: { siblings?: unknown[] } }>(res);
    expect(data.tree.siblings).toBeUndefined();
  });

  // REGRESSION GUARD. A living person's card date must use the compact app-wide
  // "b. YYYY" plate convention. The old "YYYY - Living" string is 13 chars, which
  // overflows the ~84px date strip on a 96px-wide card and rendered as the
  // truncated "1954 - Liv…". Asserting the absence of "Living" keeps it from
  // creeping back in.
  it('renders a living person\'s dates as "b. YYYY", not "YYYY - Living"', async () => {
    const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST',
      body: { FirstName: 'Alive', LastName: 'Person', BirthDate: '1954', IsDeceased: 0 },
    }));
    const { person } = await parseResponse<{ person: { Id: number } }>(res);

    const treeRes = await GET(createRequest(`http://localhost:3000/api/tree?id=${person.Id}`));
    expect(treeRes.status).toBe(200);
    const data = await parseResponse<{ tree: { lifespan: { birth: string | null; death: string | null; deceased: boolean } } }>(treeRes);

    // A living person's card reads "b. 1954" (Lifespan with no status), which fits
    // the card; so the payload doesn't mark them deceased (#808).
    expect(data.tree.lifespan).toEqual({ birth: '1954', death: null, deceased: false });
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const res = await GET(createRequest('http://localhost:3000/api/tree?id=1'));
    expect(res.status).toBe(401);
  });
});
