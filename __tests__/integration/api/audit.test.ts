import { describe, it, expect, afterEach } from 'vitest';
import { GET } from '@/app/api/audit/route';
import { GET as GET_USERS } from '@/app/api/audit/users/route';
import { POST as REVERT } from '@/app/api/audit/revert/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API /api/audit', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  // --- GET /api/audit ---
  describe('GET /api/audit', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const req = createRequest('http://localhost:3000/api/audit');
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('returns empty audit log initially', async () => {
      const req = createRequest('http://localhost:3000/api/audit');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await parseResponse<{ entries: unknown[]; total: number; page: number; pageSize: number }>(res);
      expect(data.entries).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.page).toBe(1);
    });

    it('returns 400 for invalid entityType', async () => {
      const req = createRequest('http://localhost:3000/api/audit?entityType=invalid');
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it('respects page and pageSize params', async () => {
      const req = createRequest('http://localhost:3000/api/audit?page=2&pageSize=5');
      const res = await GET(req);
      const data = await parseResponse<{ page: number; pageSize: number }>(res);
      expect(data.page).toBe(2);
      expect(data.pageSize).toBe(5);
    });

    it('returns 400 for an invalid action filter', async () => {
      const req = createRequest('http://localhost:3000/api/audit?action=frobnicate');
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for an invalid sort key', async () => {
      const req = createRequest('http://localhost:3000/api/audit?sort=sideways');
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for an invalid sort direction', async () => {
      const req = createRequest('http://localhost:3000/api/audit?dir=upways');
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it('accepts a full valid filter/sort query against an empty log', async () => {
      const req = createRequest(
        'http://localhost:3000/api/audit?action=create&sort=when&dir=asc&search=x&dateFrom=2026-01-01&dateTo=2026-12-31',
      );
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await parseResponse<{ entries: unknown[]; total: number }>(res);
      expect(data.entries).toEqual([]);
      expect(data.total).toBe(0);
    });
  });

  // --- GET /api/audit/users ---
  describe('GET /api/audit/users', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const req = createRequest('http://localhost:3000/api/audit/users');
      const res = await GET_USERS(req);
      expect(res.status).toBe(401);
    });

    it('returns an editors array (empty for a fresh tree)', async () => {
      const req = createRequest('http://localhost:3000/api/audit/users');
      const res = await GET_USERS(req);
      expect(res.status).toBe(200);
      const data = await parseResponse<{ users: unknown[] }>(res);
      expect(Array.isArray(data.users)).toBe(true);
    });
  });

  // --- POST /api/audit/revert ---
  describe('POST /api/audit/revert', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const req = createRequest('http://localhost:3000/api/audit/revert', {
        method: 'POST',
        body: { ids: [1] },
      });
      const res = await REVERT(req);
      expect(res.status).toBe(401);
    });

    it('returns 400 for empty ids array', async () => {
      const req = createRequest('http://localhost:3000/api/audit/revert', {
        method: 'POST',
        body: { ids: [] },
      });
      const res = await REVERT(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for non-number ids', async () => {
      const req = createRequest('http://localhost:3000/api/audit/revert', {
        method: 'POST',
        body: { ids: ['abc', 'def'] },
      });
      const res = await REVERT(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for more than 100 ids', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => i + 1);
      const req = createRequest('http://localhost:3000/api/audit/revert', {
        method: 'POST',
        body: { ids },
      });
      const res = await REVERT(req);
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent audit entry', async () => {
      const req = createRequest('http://localhost:3000/api/audit/revert', {
        method: 'POST',
        body: { ids: [999999] },
      });
      const res = await REVERT(req);
      expect(res.status).toBe(404);
    });

  });
});
