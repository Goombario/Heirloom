import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as GET_FLAGGED } from '@/app/api/people/flagged/route';
import { GET as GET_SUGGESTIONS } from '@/app/api/suggestions/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as CREATE_EVENT } from '@/app/api/events/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

/**
 * #794 (task audit FR-6): "Review" on the duplicates and no-events suggestions
 * opened the unfiltered People list. /api/people/flagged returns the people the
 * dashboard counted, from the same query, grouped by match; the count is in
 * pairs (#822).
 */
const describeIf = hasTestDatabase() ? describe : describe.skip;

async function createPerson(FirstName: string, LastName: string, BirthDate?: string): Promise<number> {
  const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
    method: 'POST', body: { FirstName, LastName, BirthDate },
  }));
  return (await parseResponse<{ person: { Id: number } }>(res)).person.Id;
}

async function flagged(filter: string): Promise<number[][]> {
  const res = await GET_FLAGGED(createRequest(`http://localhost:3000/api/people/flagged?filter=${filter}`));
  expect(res.status).toBe(200);
  return (await parseResponse<{ groups: number[][] }>(res)).groups;
}

describeIf('API GET /api/people/flagged (#794)', () => {
  afterEach(async () => { await cleanupTestData(); });

  it('returns the people each home suggestion counted', async () => {
    const father = await createPerson('Jean', 'Fontaine', '1850');
    const son = await createPerson('Jean', 'Fontaine', '1875');
    const a = await createPerson('Étienne', 'Lefèvre', '1820');
    const b = await createPerson('Etienne', 'Lefevre', '1821');
    await CREATE_EVENT(createRequest('http://localhost:3000/api/events', {
      method: 'POST', body: { PersonId: son, Type: 'OCCU', Description: 'Miller' },
    }));

    const suggestions = await parseResponse<{ suggestions: { type: string; count: number }[] }>(
      await GET_SUGGESTIONS(createRequest('http://localhost:3000/api/suggestions')),
    );
    const count = (type: string) => suggestions.suggestions.find(s => s.type === type)?.count ?? 0;

    const duplicates = await flagged('duplicates');
    expect(duplicates).toEqual([[a, b]]);
    expect(count('duplicates')).toBe(1);

    // #834 removed the open-ended suggestions: home lists only work that can reach zero.
    expect(suggestions.suggestions.map(s => s.type)).toEqual(['duplicates']);
    expect(duplicates.flat()).not.toContain(father);
    expect(duplicates.flat()).not.toContain(son);
  });

  it('rejects an unknown filter and an anonymous caller', async () => {
    const bad = await GET_FLAGGED(createRequest('http://localhost:3000/api/people/flagged?filter=everyone'));
    expect(bad.status).toBe(400);
    const removed = await GET_FLAGGED(createRequest('http://localhost:3000/api/people/flagged?filter=no_events'));
    expect(removed.status).toBe(400);
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const anon = await GET_FLAGGED(createRequest('http://localhost:3000/api/people/flagged?filter=duplicates'));
    expect(anon.status).toBe(401);
  });
});
