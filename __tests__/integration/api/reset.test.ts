import { describe, it, expect, afterEach, vi } from 'vitest';
import { DELETE } from '@/app/api/reset/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { GET as GET_AUDIT } from '@/app/api/audit/route';
import { GET as GET_STATS } from '@/app/api/stats/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';

// Mock rate limiter to always allow — the reset endpoint has a 2/hour limit
// which gets exhausted across tests in the same process
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockReturnValue({ success: true, remaining: 10 }),
}));

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API /api/reset', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const req = createRequest('http://localhost:3000/api/reset', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 without X-Confirm-Reset header', async () => {
    const req = createRequest('http://localhost:3000/api/reset', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(400);

    const data = await parseResponse<{ error: string }>(res);
    expect(data.error).toContain('X-Confirm-Reset');
  });

  it('returns 400 with wrong header value', async () => {
    const req = createRequest('http://localhost:3000/api/reset', {
      method: 'DELETE',
      headers: { 'X-Confirm-Reset': 'wrong' },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it('deletes all user data with correct header', async () => {
    // Create some data first
    await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST',
      body: { FirstName: 'Doomed', LastName: 'Person' },
    }));

    // Verify data exists
    let statsRes = await GET_STATS(createRequest('http://localhost:3000/api/stats'));
    let stats = await parseResponse<{ peopleCount: number }>(statsRes);
    expect(stats.peopleCount).toBe(1);

    // Reset
    const req = createRequest('http://localhost:3000/api/reset', {
      method: 'DELETE',
      headers: { 'X-Confirm-Reset': 'CONFIRM_DELETE_ALL_DATA' },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);

    const data = await parseResponse<{ success: boolean }>(res);
    expect(data.success).toBe(true);

    // Verify data is gone
    statsRes = await GET_STATS(createRequest('http://localhost:3000/api/stats'));
    stats = await parseResponse<{ peopleCount: number }>(statsRes);
    expect(stats.peopleCount).toBe(0);
  });

  it('deletes audit log entries on reset', async () => {
    // Creating a person generates an audit entry
    await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
      method: 'POST',
      body: { FirstName: 'Audited', LastName: 'Person' },
    }));

    let auditRes = await GET_AUDIT(createRequest('http://localhost:3000/api/audit'));
    let auditData = await parseResponse<{ entries: unknown[]; total: number }>(auditRes);
    expect(auditData.total).toBeGreaterThan(0);

    await DELETE(createRequest('http://localhost:3000/api/reset', {
      method: 'DELETE',
      headers: { 'X-Confirm-Reset': 'CONFIRM_DELETE_ALL_DATA' },
    }));

    auditRes = await GET_AUDIT(createRequest('http://localhost:3000/api/audit'));
    auditData = await parseResponse<{ entries: unknown[]; total: number }>(auditRes);
    expect(auditData.total).toBe(0);
  });
});
