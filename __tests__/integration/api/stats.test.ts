import { describe, it, expect, afterEach } from 'vitest';
import { GET } from '@/app/api/stats/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as CREATE_FAMILY } from '@/app/api/families/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API /api/stats', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  it('returns zero counts initially', async () => {
    const req = createRequest('http://localhost:3000/api/stats');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await parseResponse<{
      peopleCount: number;
      familiesCount: number;
      eventsCount: number;
      mediaCount: number;
    }>(res);
    expect(data.peopleCount).toBe(0);
    expect(data.familiesCount).toBe(0);
    expect(data.eventsCount).toBe(0);
    expect(data.mediaCount).toBe(0);
  });

  it('returns correct counts after creating data', async () => {
    // Create 2 people and 1 family
    await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST',
      body: { FirstName: 'Count', LastName: 'One' },
    }));
    await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST',
      body: { FirstName: 'Count', LastName: 'Two' },
    }));
    await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
      method: 'POST',
      body: {},
    }));

    const req = createRequest('http://localhost:3000/api/stats');
    const res = await GET(req);
    const data = await parseResponse<{
      peopleCount: number;
      familiesCount: number;
    }>(res);
    expect(data.peopleCount).toBe(2);
    expect(data.familiesCount).toBe(1);
  });
});
