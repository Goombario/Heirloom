import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET as SEARCH_FAMILIES } from '@/app/api/families/search/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as CREATE_FAMILY } from '@/app/api/families/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface FamilySearchResult {
  Id: number;
  husbandName: string | null;
  wifeName: string | null;
  partner1Sex: string | null;
  partner2Sex: string | null;
  husbandMediaId: number | null;
  wifeMediaId: number | null;
  husbandFocalX: number | null;
  wifeFocalX: number | null;
}

describeIf('API GET /api/families/search', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  async function createPerson(FirstName: string, LastName: string, Sex?: string): Promise<{ Id: number }> {
    const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST',
      body: { FirstName, LastName, ...(Sex ? { Sex } : {}) },
    }));
    const { person } = await parseResponse<{ person: { Id: number } }>(res);
    return person;
  }

  // NOTE: creations stay sequential — parallel first-writes race the lazy
  // default-tree provisioning right after a truncate.
  async function seedFamily(): Promise<number> {
    const husband = await createPerson('Gilbert', 'Blythe', 'M');
    const wife = await createPerson('Anne', 'Shirley', 'F');
    const res = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
      method: 'POST',
      body: { HusbandId: husband.Id, WifeId: wife.Id },
    }));
    const { family } = await parseResponse<{ family: { Id: number } }>(res);
    return family.Id;
  }

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const res = await SEARCH_FAMILIES(createRequest('http://localhost:3000/api/families/search?q=Anne'));
    expect(res.status).toBe(401);
  });

  it('returns 400 without a query parameter', async () => {
    const res = await SEARCH_FAMILIES(createRequest('http://localhost:3000/api/families/search'));
    expect(res.status).toBe(400);
  });

  it('finds a family by husband name', async () => {
    const familyId = await seedFamily();
    const res = await SEARCH_FAMILIES(createRequest('http://localhost:3000/api/families/search?q=Gilbert'));
    expect(res.status).toBe(200);
    const data = await parseResponse<{ families: FamilySearchResult[] }>(res);
    expect(data.families.map(f => f.Id)).toContain(familyId);
    expect(data.families[0].husbandName).toContain('Gilbert');
  });

  it('finds a family by wife full name', async () => {
    const familyId = await seedFamily();
    const res = await SEARCH_FAMILIES(createRequest('http://localhost:3000/api/families/search?q=Anne+Shirley'));
    expect(res.status).toBe(200);
    const data = await parseResponse<{ families: FamilySearchResult[] }>(res);
    expect(data.families.map(f => f.Id)).toContain(familyId);
    expect(data.families[0].wifeName).toContain('Anne');
  });

  // The search results carry avatars, so the query has to return the same
  // primary-photo shape getAllFamiliesWithSpouses does. FamilyWithSpouseNames
  // declared these fields long before this query selected any of them.
  it('returns spouse sex and primary-photo fields for each result', async () => {
    await seedFamily();
    const res = await SEARCH_FAMILIES(createRequest('http://localhost:3000/api/families/search?q=Blythe'));
    const data = await parseResponse<{ families: FamilySearchResult[] }>(res);
    const family = data.families[0];
    expect(family.partner1Sex).toBe('M');
    expect(family.partner2Sex).toBe('F');
    // No photos seeded — the fields must be present and null, not absent.
    expect(family).toHaveProperty('husbandMediaId', null);
    expect(family).toHaveProperty('wifeMediaId', null);
    expect(family).toHaveProperty('husbandFocalX', null);
    expect(family).toHaveProperty('wifeFocalX', null);
  });

  it('returns one row per family despite the two photo lateral joins', async () => {
    const familyId = await seedFamily();
    const res = await SEARCH_FAMILIES(createRequest('http://localhost:3000/api/families/search?q=Blythe'));
    const data = await parseResponse<{ families: FamilySearchResult[] }>(res);
    expect(data.families.filter(f => f.Id === familyId)).toHaveLength(1);
  });

  it('returns an empty wrapped list when nothing matches', async () => {
    await seedFamily();
    const res = await SEARCH_FAMILIES(createRequest('http://localhost:3000/api/families/search?q=Nonexistent'));
    expect(res.status).toBe(200);
    const data = await parseResponse<{ families: FamilySearchResult[] }>(res);
    expect(data.families).toEqual([]);
  });
});
