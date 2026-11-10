import { describe, it, expect, vi } from 'vitest';
import { GET as GET_PEOPLE } from '@/app/api/people/route';
import { GET as GET_STATS } from '@/app/api/stats/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { hasTestDatabase } from '../../setup/db-helpers';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('Authentication', () => {
  it('returns 401 when not authenticated (people)', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);

    const req = createRequest('http://localhost:3000/api/people');
    const res = await GET_PEOPLE(req);
    expect(res.status).toBe(401);

    const data = await parseResponse<{ error: string }>(res);
    expect(data.error).toBe('Unauthorized');
  });

  it('returns 401 when not authenticated (stats)', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);

    const req = createRequest('http://localhost:3000/api/stats');
    const res = await GET_STATS(req);
    expect(res.status).toBe(401);
  });
});
