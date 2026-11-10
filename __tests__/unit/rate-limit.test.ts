import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import fresh module for each test by using dynamic import
// The rate limiter uses module-level state (Map), so we need isolation
describe('rateLimit', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  it('allows requests under the limit', async () => {
    const { rateLimit } = await import('@/lib/rate-limit');
    const result = rateLimit('user1:test', 5, 60000);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('decrements remaining count', async () => {
    const { rateLimit } = await import('@/lib/rate-limit');
    rateLimit('user2:test', 5, 60000);
    rateLimit('user2:test', 5, 60000);
    const result = rateLimit('user2:test', 5, 60000);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('blocks requests at the limit', async () => {
    const { rateLimit } = await import('@/lib/rate-limit');
    for (let i = 0; i < 3; i++) {
      rateLimit('user3:test', 3, 60000);
    }
    const result = rateLimit('user3:test', 3, 60000);
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('says how long until the oldest request leaves the window', async () => {
    vi.useFakeTimers();
    const { rateLimit } = await import('@/lib/rate-limit');
    rateLimit('user-retry:test', 2, 60000);
    vi.advanceTimersByTime(10000);
    expect(rateLimit('user-retry:test', 2, 60000).retryAfterMs).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(rateLimit('user-retry:test', 2, 60000).retryAfterMs).toBe(45000);
  });

  it('resets after window expires', async () => {
    vi.useFakeTimers();
    const { rateLimit } = await import('@/lib/rate-limit');

    // Fill up the limit
    for (let i = 0; i < 3; i++) {
      rateLimit('user4:test', 3, 10000);
    }
    expect(rateLimit('user4:test', 3, 10000).success).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(11000);

    const result = rateLimit('user4:test', 3, 10000);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(2);
  });

  // Regression: cleanup() used to prune with the *calling* window, so traffic on
  // a short-window bucket (uploads, 15 min) swept away timestamps belonging to a
  // long-window bucket (reset, 1 hour) and silently refilled its budget.
  it('does not let a short-window bucket erode a long-window one', async () => {
    vi.useFakeTimers();
    const { rateLimit } = await import('@/lib/rate-limit');

    // Exhaust a 1-hour budget of 2.
    rateLimit('user5:long', 2, 60 * 60 * 1000);
    rateLimit('user5:long', 2, 60 * 60 * 1000);
    expect(rateLimit('user5:long', 2, 60 * 60 * 1000).success).toBe(false);

    // 20 minutes later — past the short window, well inside the long one —
    // drive enough short-window traffic to trigger a cleanup sweep.
    vi.advanceTimersByTime(20 * 60 * 1000);
    rateLimit('user5:short', 100, 15 * 60 * 1000);

    // The long bucket must still be exhausted.
    expect(rateLimit('user5:long', 2, 60 * 60 * 1000).success).toBe(false);
  });

  it('isolates different keys', async () => {
    const { rateLimit } = await import('@/lib/rate-limit');
    for (let i = 0; i < 3; i++) {
      rateLimit('userA:test', 3, 60000);
    }
    // userA is exhausted
    expect(rateLimit('userA:test', 3, 60000).success).toBe(false);
    // userB is fresh
    expect(rateLimit('userB:test', 3, 60000).success).toBe(true);
  });
});
