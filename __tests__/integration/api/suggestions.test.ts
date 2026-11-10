import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as GET_SUGGESTIONS } from '@/app/api/suggestions/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface SuggestionShape {
    type: 'duplicates';
    count: number;
    href: string;
}

describeIf('API /api/suggestions', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    it('returns 401 without a user', async () => {
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
        const res = await GET_SUGGESTIONS(createRequest('http://localhost:3000/api/suggestions'));
        expect(res.status).toBe(401);
    });

    it('returns the locked contract { type, count, href } with no server-built label', async () => {
        // Seed two duplicates by name.
        await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST', body: { FirstName: 'Same', LastName: 'Name' },
        }));
        await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST', body: { FirstName: 'Same', LastName: 'Name' },
        }));

        const res = await GET_SUGGESTIONS(createRequest('http://localhost:3000/api/suggestions'));
        expect(res.status).toBe(200);
        const { suggestions } = await parseResponse<{ suggestions: SuggestionShape[] }>(res);
        const dup = suggestions.find(s => s.type === 'duplicates');
        expect(dup).toBeDefined();
        expect(dup!.count).toBeGreaterThanOrEqual(1);
        expect(dup!.href).toBe('/people?filter=duplicates');
        // Critical: API must NOT carry a label — the client translates from type+count.
        expect((dup as unknown as { label?: string }).label).toBeUndefined();
    });
});
