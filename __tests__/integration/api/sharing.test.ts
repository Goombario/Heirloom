import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';
import { GET, POST } from '@/app/api/sharing/route';
import { PUT, DELETE as DELETE_SHARE } from '@/app/api/sharing/[id]/route';
import { PUT as PUT_PENDING, DELETE as DELETE_PENDING } from '@/app/api/sharing/pending/[id]/route';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { getUserFromRequest, isDesktopMode } from '@/lib/auth/get-user-from-request';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API /api/sharing', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe('POST /api/sharing', () => {
    it('returns 400 without email', async () => {
      const req = createRequest('http://localhost:3000/api/sharing', {
        method: 'POST',
        body: { permission: 'view' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 without valid permission', async () => {
      const req = createRequest('http://localhost:3000/api/sharing', {
        method: 'POST',
        body: { email: 'other@example.com', permission: 'admin' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('stores a pending share for an address with no account (#1228)', async () => {
      const req = createRequest('http://localhost:3000/api/sharing', {
        method: 'POST',
        body: { email: 'Nobody@Nowhere.com', permission: 'view' },
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      const data = await parseResponse<{ share?: unknown; pending: { Email: string; Permission: string } }>(res);
      expect(data.share).toBeUndefined();
      expect(data.pending).toMatchObject({ Email: 'nobody@nowhere.com', Permission: 'view' });

      const again = await POST(createRequest('http://localhost:3000/api/sharing', {
        method: 'POST',
        body: { email: 'nobody@nowhere.com', permission: 'edit' },
      }));
      expect(again.status).toBe(409);
    });

    it('returns 400 for an address that is not an email', async () => {
      const res = await POST(createRequest('http://localhost:3000/api/sharing', {
        method: 'POST',
        body: { email: 'nobody', permission: 'view' },
      }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when sharing with yourself', async () => {
      const req = createRequest('http://localhost:3000/api/sharing', {
        method: 'POST',
        body: { email: TEST_USER.email, permission: 'view' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await parseResponse<{ error: string }>(res);
      expect(data.error).toContain('yourself');
    });

    it('creates a share successfully', async () => {
      const req = createRequest('http://localhost:3000/api/sharing', {
        method: 'POST',
        body: { email: TEST_USER_2.email, permission: 'view' },
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/sharing', () => {
    it('returns empty shares initially', async () => {
      const res = await GET();
      expect(res.status).toBe(200);

      const data = await parseResponse<{ shares: unknown[]; pending: unknown[] }>(res);
      expect(data.shares).toEqual([]);
      expect(data.pending).toEqual([]);
    });

    it('lists pending shares beside real ones', async () => {
      await POST(createRequest('http://localhost:3000/api/sharing', {
        method: 'POST',
        body: { email: 'newcomer@example.com', permission: 'contribute' },
      }));

      const data = await parseResponse<{ shares: unknown[]; pending: { Email: string; Permission: string }[] }>(await GET());
      expect(data.shares).toEqual([]);
      expect(data.pending).toEqual([expect.objectContaining({ Email: 'newcomer@example.com', Permission: 'contribute' })]);
    });

    it('returns shares after creating one', async () => {
      // Create a share first
      await POST(createRequest('http://localhost:3000/api/sharing', {
        method: 'POST',
        body: { email: TEST_USER_2.email, permission: 'edit' },
      }));

      const res = await GET();
      const data = await parseResponse<{ shares: { Permission: string }[] }>(res);
      expect(data.shares).toHaveLength(1);
      expect(data.shares[0].Permission).toBe('edit');
    });
  });

  /** Helper: seed a share from TEST_USER → TEST_USER_2 with 'view' and return the share Id */
  async function seedShare(): Promise<number> {
    const res = await POST(createRequest('http://localhost:3000/api/sharing', {
      method: 'POST',
      body: { email: TEST_USER_2.email, permission: 'view' },
    }));
    expect(res.status).toBe(201);
    const data = await parseResponse<{ share: { Id: number } }>(res);
    return data.share.Id;
  }

  describe('PUT /api/sharing/[id]', () => {
    it('returns 404 in desktop mode', async () => {
      vi.mocked(isDesktopMode).mockReturnValueOnce(true);
      const req = createRequest('http://localhost:3000/api/sharing/1', { method: 'PUT', body: { permission: 'edit' } });
      const res = await PUT(req, { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(404);
    });

    it('returns 401 when unauthenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const req = createRequest('http://localhost:3000/api/sharing/1', { method: 'PUT', body: { permission: 'edit' } });
      const res = await PUT(req, { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(401);
    });

    it('returns 400 for non-numeric id', async () => {
      const req = createRequest('http://localhost:3000/api/sharing/abc', { method: 'PUT', body: { permission: 'edit' } });
      const res = await PUT(req, { params: Promise.resolve({ id: 'abc' }) });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid permission value', async () => {
      const shareId = await seedShare();
      const req = createRequest(`http://localhost:3000/api/sharing/${shareId}`, { method: 'PUT', body: { permission: 'admin' } });
      const res = await PUT(req, { params: Promise.resolve({ id: String(shareId) }) });
      expect(res.status).toBe(400);
      const data = await parseResponse<{ error: string }>(res);
      expect(data.error).toBe('Invalid permission');
    });

    it('returns 404 when share does not exist', async () => {
      const req = createRequest('http://localhost:3000/api/sharing/999999', { method: 'PUT', body: { permission: 'edit' } });
      const res = await PUT(req, { params: Promise.resolve({ id: '999999' }) });
      expect(res.status).toBe(404);
    });

    it('returns 403 when non-owner tries to update', async () => {
      const shareId = await seedShare();
      // Switch to TEST_USER_2 (not the owner of the share)
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(`http://localhost:3000/api/sharing/${shareId}`, { method: 'PUT', body: { permission: 'edit' } });
      const res = await PUT(req, { params: Promise.resolve({ id: String(shareId) }) });
      expect(res.status).toBe(403);
    });

    it('updates permission successfully and returns updated share', async () => {
      const shareId = await seedShare();
      const req = createRequest(`http://localhost:3000/api/sharing/${shareId}`, { method: 'PUT', body: { permission: 'edit' } });
      const res = await PUT(req, { params: Promise.resolve({ id: String(shareId) }) });
      expect(res.status).toBe(200);
      const data = await parseResponse<{ share: { Permission: string } }>(res);
      expect(data.share.Permission).toBe('edit');
    });

    it('allows all valid permission values', async () => {
      for (const permission of ['view', 'contribute', 'edit'] as const) {
        const shareId = await seedShare();
        const req = createRequest(`http://localhost:3000/api/sharing/${shareId}`, { method: 'PUT', body: { permission } });
        const res = await PUT(req, { params: Promise.resolve({ id: String(shareId) }) });
        expect(res.status).toBe(200);
        const data = await parseResponse<{ share: { Permission: string } }>(res);
        expect(data.share.Permission).toBe(permission);
        await cleanupTestData();
      }
    });
  });

  describe('DELETE /api/sharing/[id] (revoke)', () => {
    it('returns 404 in desktop mode', async () => {
      vi.mocked(isDesktopMode).mockReturnValueOnce(true);
      const req = createRequest('http://localhost:3000/api/sharing/1', { method: 'DELETE' });
      const res = await DELETE_SHARE(req, { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(404);
    });

    it('returns 401 when unauthenticated', async () => {
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      const req = createRequest('http://localhost:3000/api/sharing/1', { method: 'DELETE' });
      const res = await DELETE_SHARE(req, { params: Promise.resolve({ id: '1' }) });
      expect(res.status).toBe(401);
    });

    it('returns 400 for non-numeric id', async () => {
      const req = createRequest('http://localhost:3000/api/sharing/abc', { method: 'DELETE' });
      const res = await DELETE_SHARE(req, { params: Promise.resolve({ id: 'abc' }) });
      expect(res.status).toBe(400);
    });

    it('returns 404 when share does not exist', async () => {
      const req = createRequest('http://localhost:3000/api/sharing/999999', { method: 'DELETE' });
      const res = await DELETE_SHARE(req, { params: Promise.resolve({ id: '999999' }) });
      expect(res.status).toBe(404);
    });

    it('returns 403 when non-owner tries to revoke', async () => {
      const shareId = await seedShare();
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const req = createRequest(`http://localhost:3000/api/sharing/${shareId}`, { method: 'DELETE' });
      const res = await DELETE_SHARE(req, { params: Promise.resolve({ id: String(shareId) }) });
      expect(res.status).toBe(403);

      // The share must survive the failed revoke
      const listRes = await GET();
      const list = await parseResponse<{ shares: { Id: number }[] }>(listRes);
      expect(list.shares.map(s => s.Id)).toContain(shareId);
    });

    it('revokes a share and removes it from the list', async () => {
      const shareId = await seedShare();
      const req = createRequest(`http://localhost:3000/api/sharing/${shareId}`, { method: 'DELETE' });
      const res = await DELETE_SHARE(req, { params: Promise.resolve({ id: String(shareId) }) });
      expect(res.status).toBe(204);

      const listRes = await GET();
      const list = await parseResponse<{ shares: unknown[] }>(listRes);
      expect(list.shares).toEqual([]);
    });
  });

  describe('/api/sharing/pending/[id] (#1228)', () => {
    async function seedPending(): Promise<number> {
      const res = await POST(createRequest('http://localhost:3000/api/sharing', {
        method: 'POST',
        body: { email: 'newcomer@example.com', permission: 'view' },
      }));
      expect(res.status).toBe(201);
      return (await parseResponse<{ pending: { Id: number } }>(res)).pending.Id;
    }
    const at = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

    it('returns 404 in desktop mode and 401 when unauthenticated', async () => {
      vi.mocked(isDesktopMode).mockReturnValueOnce(true);
      expect((await DELETE_PENDING(createRequest('http://localhost:3000/api/sharing/pending/1', { method: 'DELETE' }), at(1))).status).toBe(404);
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
      expect((await DELETE_PENDING(createRequest('http://localhost:3000/api/sharing/pending/1', { method: 'DELETE' }), at(1))).status).toBe(401);
    });

    it('changes the permission, and only for the owner', async () => {
      const id = await seedPending();
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      const denied = await PUT_PENDING(createRequest(`http://localhost:3000/api/sharing/pending/${id}`, { method: 'PUT', body: { permission: 'edit' } }), at(id));
      expect(denied.status).toBe(403);

      const res = await PUT_PENDING(createRequest(`http://localhost:3000/api/sharing/pending/${id}`, { method: 'PUT', body: { permission: 'edit' } }), at(id));
      expect(res.status).toBe(200);
      expect((await parseResponse<{ pending: { Permission: string } }>(res)).pending.Permission).toBe('edit');
    });

    it('removes it, and only for the owner', async () => {
      const id = await seedPending();
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
      expect((await DELETE_PENDING(createRequest(`http://localhost:3000/api/sharing/pending/${id}`, { method: 'DELETE' }), at(id))).status).toBe(403);

      expect((await DELETE_PENDING(createRequest(`http://localhost:3000/api/sharing/pending/${id}`, { method: 'DELETE' }), at(id))).status).toBe(204);
      expect((await DELETE_PENDING(createRequest(`http://localhost:3000/api/sharing/pending/${id}`, { method: 'DELETE' }), at(id))).status).toBe(404);
      const list = await parseResponse<{ pending: unknown[] }>(await GET());
      expect(list.pending).toEqual([]);
    });
  });
});
