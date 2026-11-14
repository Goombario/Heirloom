import { describe, it, expect, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET, PUT } from '@/app/api/users/me/last-seen-version/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;
const URL_ = 'http://localhost:3000/api/users/me/last-seen-version';
const put = (body: unknown) => PUT(createRequest(URL_, { method: 'PUT', body: body as Record<string, unknown> }));

describeIf('API /api/users/me/last-seen-version (#35)', () => {
  it('records a version and reads it back', async () => {
    expect((await put({ version: '1.1.0-rc.3' })).status).toBe(200);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await parseResponse<{ version: string | null }>(res)).toEqual({ version: '1.1.0-rc.3' });
    expect((await put({ version: '1.1.0' })).status).toBe(200);
    expect(await parseResponse<{ version: string | null }>(await GET())).toEqual({ version: '1.1.0' });
  });

  it('refuses anything that is not an app version', async () => {
    for (const version of ['', 'v1.1.0', '1.1', '<script>', 42, null]) {
      expect((await put({ version })).status).toBe(400);
    }
    expect((await put(undefined)).status).toBe(400);
  });

  it('needs a signed-in user', async () => {
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    expect((await GET()).status).toBe(401);
    vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
    expect((await put({ version: '1.1.0' })).status).toBe(401);
  });
});
