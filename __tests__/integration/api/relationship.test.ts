import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/relationship/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as CREATE_FAMILY } from '@/app/api/families/route';
import { POST as ADD_CHILD } from '@/app/api/families/[id]/children/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API /api/relationship', () => {
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

  async function createFamilyWithChildren(
    husbandId: number | null,
    wifeId: number | null,
    childIds: number[]
  ) {
    const famRes = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
      method: 'POST',
      body: { HusbandId: husbandId, WifeId: wifeId },
    }));
    const { family } = await parseResponse<{ family: { Id: number } }>(famRes);

    for (const childId of childIds) {
      await ADD_CHILD(
        createRequest(`http://localhost:3000/api/families/${family.Id}/children`, {
          method: 'POST',
          body: { childId },
        }),
        { params: Promise.resolve({ id: String(family.Id) }) }
      );
    }
    return family;
  }

  it('returns 400 when person IDs are missing', async () => {
    const req = createRequest('http://localhost:3000/api/relationship');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns same person for identical IDs', async () => {
    const person = await createPerson('Solo', 'Traveler');
    const req = createRequest(`http://localhost:3000/api/relationship?person1=${person.Id}&person2=${person.Id}`);
    const res = await GET(req);
    const data = await parseResponse<{ relationship: string; degree: number }>(res);
    expect(data.relationship).toBe('Same person');
    expect(data.degree).toBe(0);
  });

  it('detects spouse relationship', async () => {
    const husband = await createPerson('Husband', 'Test');
    const wife = await createPerson('Wife', 'Test');
    await createFamilyWithChildren(husband.Id, wife.Id, []);

    const req = createRequest(`http://localhost:3000/api/relationship?person1=${husband.Id}&person2=${wife.Id}`);
    const res = await GET(req);
    const data = await parseResponse<{ relationship: string; degree: number }>(res);
    expect(data.relationship).toBe('Spouse');
    expect(data.degree).toBe(1);
  });

  it('detects parent-child relationship', async () => {
    const parent = await createPerson('Papa', 'Bear');
    const child = await createPerson('Baby', 'Bear');
    await createFamilyWithChildren(parent.Id, null, [child.Id]);

    // From child to parent = "Parent" (the parent is the parent of the child)
    const req = createRequest(`http://localhost:3000/api/relationship?person1=${child.Id}&person2=${parent.Id}`);
    const res = await GET(req);
    const data = await parseResponse<{ relationship: string }>(res);
    expect(data.relationship).toBe('Parent');
  });

  it('detects sibling relationship', async () => {
    const parent = await createPerson('Mama', 'Duck');
    const child1 = await createPerson('Huey', 'Duck');
    const child2 = await createPerson('Dewey', 'Duck');
    await createFamilyWithChildren(parent.Id, null, [child1.Id, child2.Id]);

    const req = createRequest(`http://localhost:3000/api/relationship?person1=${child1.Id}&person2=${child2.Id}`);
    const res = await GET(req);
    const data = await parseResponse<{ relationship: string }>(res);
    expect(data.relationship).toBe('Sibling');
  });

  it('detects grandparent relationship', async () => {
    const grandparent = await createPerson('Grand', 'Elder');
    const parent = await createPerson('Middle', 'Gen');
    const grandchild = await createPerson('Young', 'One');
    await createFamilyWithChildren(grandparent.Id, null, [parent.Id]);
    await createFamilyWithChildren(parent.Id, null, [grandchild.Id]);

    const req = createRequest(`http://localhost:3000/api/relationship?person1=${grandchild.Id}&person2=${grandparent.Id}`);
    const res = await GET(req);
    const data = await parseResponse<{ relationship: string }>(res);
    expect(data.relationship).toBe('Grandparent');
  });

  it('returns no relationship for unrelated people', async () => {
    const person1 = await createPerson('Stranger', 'One');
    const person2 = await createPerson('Stranger', 'Two');

    const req = createRequest(`http://localhost:3000/api/relationship?person1=${person1.Id}&person2=${person2.Id}`);
    const res = await GET(req);
    const data = await parseResponse<{ relationship: string; degree: number }>(res);
    expect(data.relationship).toBe('No relationship found');
    expect(data.degree).toBe(-1);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const res = await GET(createRequest('http://localhost:3000/api/relationship?person1=1&person2=2'));
    expect(res.status).toBe(401);
  });
});
