/**
 * In-memory sliding window rate limiter.
 * No external dependencies — suitable for single-instance deployments.
 */

const requestLog = new Map<string, number[]>();

// Clean up expired entries every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

// The sweep is global but buckets have different windows, so it must prune with
// the LONGEST window any caller has used. Pruning with the calling window let a
// high-traffic short bucket (uploads, 15 min) delete timestamps still inside a
// long bucket's window (reset, 1 hour) and silently refill that budget.
let maxWindowSeenMs = 0;

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const cutoff = now - maxWindowSeenMs;
  for (const [key, timestamps] of requestLog) {
    const valid = timestamps.filter(t => t > cutoff);
    if (valid.length === 0) {
      requestLog.delete(key);
    } else {
      requestLog.set(key, valid);
    }
  }
}

/**
 * Check and record a request against the rate limit.
 *
 * @param key - Unique identifier (e.g. `userId:routeName`)
 * @param limit - Max requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns { success, remaining, retryAfterMs } - Whether the request is allowed, how
 *   many remain, and (when refused) how long until the oldest request leaves the window
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { success: boolean; remaining: number; retryAfterMs: number } {
  if (windowMs > maxWindowSeenMs) maxWindowSeenMs = windowMs;
  cleanup();

  const now = Date.now();
  const cutoff = now - windowMs;
  const timestamps = requestLog.get(key) ?? [];
  const valid = timestamps.filter(t => t > cutoff);

  if (valid.length >= limit) {
    return { success: false, remaining: 0, retryAfterMs: Math.max(0, valid[0] + windowMs - now) };
  }

  valid.push(now);
  requestLog.set(key, valid);
  return { success: true, remaining: limit - valid.length, retryAfterMs: 0 };
}
