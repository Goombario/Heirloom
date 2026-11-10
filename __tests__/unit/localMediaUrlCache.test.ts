import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  acquireObjectUrl,
  releaseObjectUrl,
  peekObjectUrl,
  invalidateObjectUrl,
  __resetObjectUrlCache,
} from '@/lib/media/localMediaUrlCache';

describe('localMediaUrlCache', () => {
  let created = 0;
  let revoked: string[] = [];

  beforeEach(() => {
    __resetObjectUrlCache();
    created = 0;
    revoked = [];
    globalThis.URL.createObjectURL = vi.fn(() => `blob:mock-${created++}`);
    globalThis.URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url); });
  });

  it('shares one load + URL across concurrent acquires of the same key', async () => {
    const loader = vi.fn(async () => 'blob:shared');
    const [a, b] = await Promise.all([
      acquireObjectUrl('k', loader),
      acquireObjectUrl('k', loader),
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(a).toBe('blob:shared');
    expect(b).toBe('blob:shared');
  });

  it('does not revoke while consumers remain (refCount 2 → 1)', async () => {
    const loader = vi.fn(async () => 'blob:x');
    await Promise.all([acquireObjectUrl('k', loader), acquireObjectUrl('k', loader)]);

    releaseObjectUrl('k'); // 2 → 1
    await Promise.resolve();
    expect(revoked).toHaveLength(0);
  });

  it('retains (does NOT revoke) the URL when the last consumer leaves, and reuses it on re-acquire', async () => {
    const loader = vi.fn(async () => 'blob:x');
    await Promise.all([acquireObjectUrl('k', loader), acquireObjectUrl('k', loader)]);

    releaseObjectUrl('k'); // 2 → 1
    releaseObjectUrl('k'); // 1 → 0 → retained, NOT revoked
    await Promise.resolve();
    await Promise.resolve();
    expect(revoked).toEqual([]); // warm cache — kept alive for the next visit
    expect(peekObjectUrl('k')).toBe('blob:x');

    // A revisit re-acquires the SAME warm URL — the loader is not re-run.
    const loader2 = vi.fn(async () => 'blob:y');
    const url = await acquireObjectUrl('k', loader2);
    expect(loader2).not.toHaveBeenCalled();
    expect(url).toBe('blob:x');
  });

  it('invalidates a rejected entry so a later acquire can retry', async () => {
    await expect(acquireObjectUrl('failed', async () => { throw new Error('read failed'); })).rejects.toThrow('read failed');
    invalidateObjectUrl('failed');

    await expect(acquireObjectUrl('failed', async () => 'blob:recovered')).resolves.toBe('blob:recovered');
  });

  it('evicts (and revokes) the oldest retained URL past the retention cap', async () => {
    const CAP = 24;
    // Fill the LRU with CAP retained entries: k0 is the oldest.
    for (let i = 0; i < CAP; i++) {
      await acquireObjectUrl(`k${i}`, async () => `blob:${i}`);
      releaseObjectUrl(`k${i}`); // → retained
    }
    await Promise.resolve();
    expect(revoked).toEqual([]); // exactly at cap, nothing evicted

    // One more retained entry pushes the count past the cap → oldest (k0) evicted.
    await acquireObjectUrl('k24', async () => 'blob:24');
    releaseObjectUrl('k24');
    await Promise.resolve();
    await Promise.resolve();
    expect(revoked).toEqual(['blob:0']);
    expect(peekObjectUrl('k0')).toBeNull(); // evicted
    expect(peekObjectUrl('k1')).toBe('blob:1'); // still retained
  });

  it('re-acquiring a retained entry lifts it out of the LRU so it is not evicted', async () => {
    const CAP = 24;
    for (let i = 0; i < CAP; i++) {
      await acquireObjectUrl(`k${i}`, async () => `blob:${i}`);
      releaseObjectUrl(`k${i}`); // retained {k0..k23}
    }
    // Re-acquire the oldest (k0) and KEEP it held — it leaves the LRU (retained→23).
    await acquireObjectUrl('k0', async () => 'blob:0-reused');
    // Two fresh retained entries push the LRU to 25 → oldest retained (k1) evicted.
    await acquireObjectUrl('k24', async () => 'blob:24');
    releaseObjectUrl('k24');
    await acquireObjectUrl('k25', async () => 'blob:25');
    releaseObjectUrl('k25');
    await Promise.resolve();
    await Promise.resolve();
    expect(revoked).toEqual(['blob:1']); // k1 was the oldest, not the held k0
    expect(peekObjectUrl('k0')).toBe('blob:0'); // held (re-acquired), never evicted
  });

  describe('peekObjectUrl', () => {
    it('returns null for an absent key', () => {
      expect(peekObjectUrl('missing')).toBeNull();
    });

    it('returns null while the blob is still loading, then the URL once resolved', async () => {
      let resolve!: (url: string) => void;
      acquireObjectUrl('k', () => new Promise<string>((r) => { resolve = r; }));
      // Loader pending — url not yet assigned.
      expect(peekObjectUrl('k')).toBeNull();
      resolve('blob:ready');
      await Promise.resolve();
      expect(peekObjectUrl('k')).toBe('blob:ready');
    });

    it('is a pure read — never creates an entry or takes a reference', async () => {
      expect(peekObjectUrl('absent')).toBeNull();
      expect(peekObjectUrl('absent')).toBeNull(); // repeated peeks create nothing

      await acquireObjectUrl('k', async () => 'blob:x'); // refCount 1
      peekObjectUrl('k'); // must not bump refCount
      peekObjectUrl('k');
      releaseObjectUrl('k'); // sole consumer → retained (would stay active if peek held a ref)
      await Promise.resolve();
      expect(revoked).toEqual([]); // retained warm, not revoked
      expect(peekObjectUrl('k')).toBe('blob:x');
    });
  });
});
