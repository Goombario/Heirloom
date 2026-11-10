import { describe, it, expect, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as GET_ME } from '@/app/api/users/me/route';
import { GET as GET_DESKTOP } from '@/app/api/desktop/route';
import { parseResponse, TEST_USER } from '../../setup/test-helpers';

/**
 * Coverage for two previously-untested read routes:
 *  - GET /api/users/me   — returns the session user, 401 when unauthenticated.
 *  - GET /api/desktop     — reports the DESKTOP_MODE flag (public, pre-auth).
 * Neither touches per-tree data, so no DB is required — these run regardless of
 * hasTestDatabase(). `getUserFromRequest` / `isDesktopMode` are globally mocked
 * (see __tests__/setup/mock-auth.ts).
 */
describe('GET /api/users/me', () => {
  it('returns the authenticated session user', async () => {
    const res = await GET_ME();
    expect(res.status).toBe(200);
    const { user } = await parseResponse<{ user: { id: number; email: string } }>(res);
    expect(user.id).toBe(TEST_USER.id);
    expect(user.email).toBe('test@example.com');
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    const res = await GET_ME();
    expect(res.status).toBe(401);
    const { error } = await parseResponse<{ error: string }>(res);
    expect(error).toBe('Unauthorized');
  });
});

describe('GET /api/desktop', () => {
  it('reports the desktop-mode flag without requiring auth', async () => {
    // isDesktopMode is mocked to false in the test harness; the route only
    // reports the flag, it can never activate the bypass from a request.
    const res = await GET_DESKTOP();
    expect(res.status).toBe(200);
    const body = await parseResponse<Record<string, unknown>>(res);
    // Only the flag: the route is public, so it must not echo the environment (#933).
    expect(body).toEqual({ isDesktop: false });
  });
});
