import { describe, it, expect } from 'vitest';
import { DELETE as RESET } from '@/app/api/reset/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;

// Route-level rate-limit *wiring* test (the algorithm itself is covered in
// __tests__/unit/rate-limit.test.ts). Uses the real in-memory limiter — this
// file must NOT vi.mock('@/lib/rate-limit') (reset.test.ts does, which is why
// this lives in its own file: vitest gives each file a fresh module registry,
// so the limiter's counters start empty here).
//
// The reset route consumes its 2/hour budget BEFORE validating the
// X-Confirm-Reset header, so two header-less calls (cheap 400s, no data
// touched) exhaust the window and the third call must surface a 429 with the
// standard { error } JSON body.
describeIf('rate-limit route wiring', () => {
  it('returns 429 with { error } JSON once the reset window is exhausted', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await RESET(createRequest('http://localhost:3000/api/reset', { method: 'DELETE' }));
      expect(res.status).toBe(400); // missing confirm header, but budget consumed
    }

    const res = await RESET(createRequest('http://localhost:3000/api/reset', { method: 'DELETE' }));
    expect(res.status).toBe(429);
    const data = await parseResponse<{ error: string }>(res);
    expect(data.error).toContain('Too many');
  });
});
