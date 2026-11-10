/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { dataCache } from '@/lib/data/cache';
import { useCachedResource } from '@/app/components/useCachedResource';

describe('useCachedResource', () => {
  beforeEach(() => dataCache.clear());

  it('is loading on a cache miss, then resolves and caches', async () => {
    const fetcher = vi.fn(async () => ({ n: 1 }));
    const { result } = renderHook(() => useCachedResource('k', fetcher));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ n: 1 });
    expect(dataCache.get('k')).toEqual({ n: 1 });
  });

  it('returns cached data synchronously (no loading) on a hit, and revalidates', async () => {
    dataCache.set('k', { n: 1 });
    const fetcher = vi.fn(async () => ({ n: 2 }));
    const { result } = renderHook(() => useCachedResource('k', fetcher));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({ n: 1 });
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never hands out the old key's data under a new key (#1232)", async () => {
    dataCache.set('tree=1', { tree: 1 });
    const seen: { key: string; data: unknown }[] = [];
    const fetcher = vi.fn(() => new Promise<never>(() => {}));
    const { rerender } = renderHook(({ k }) => {
      const r = useCachedResource(k, fetcher);
      seen.push({ key: k, data: r.data });
      return r;
    }, { initialProps: { k: 'tree=1' } });
    rerender({ k: 'tree=2' });
    expect(seen.filter((s) => s.key === 'tree=2').every((s) => s.data === undefined)).toBe(true);
  });

  it('does nothing when key is null', () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() => useCachedResource(null, fetcher));
    expect(result.current.loading).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not repopulate the cache when a write clears it mid-flight', async () => {
    let resolveFetch!: (v: { n: number }) => void;
    const fetcher = vi.fn(() => new Promise<{ n: number }>((r) => { resolveFetch = r; }));
    const { result } = renderHook(() => useCachedResource('k', fetcher));
    expect(result.current.loading).toBe(true);

    // A write invalidates the cache while the revalidation is still in flight.
    act(() => { dataCache.clear(); });
    // The (now-stale) fetch resolves afterwards.
    await act(async () => { resolveFetch({ n: 1 }); });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Local state reflects what this component fetched, but the shared cache was
    // NOT repopulated — the invalidation stands.
    expect(result.current.data).toEqual({ n: 1 });
    expect(dataCache.has('k')).toBe(false);
  });

  it('records the error (and does not cache) when the fetcher rejects', async () => {
    const boom = new Error('boom');
    const fetcher = vi.fn(async () => { throw boom; });
    const { result } = renderHook(() => useCachedResource('k', fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(boom);
    expect(dataCache.has('k')).toBe(false);
  });

  it('preserves stale data while exposing a failed revalidation', async () => {
    const stale = { n: 1 };
    const boom = new Error('revalidation failed');
    dataCache.set('k', stale);
    const fetcher = vi.fn(async () => { throw boom; });
    const { result } = renderHook(() => useCachedResource('k', fetcher));

    await waitFor(() => expect(result.current.error).toBe(boom));
    expect(result.current.data).toBe(stale);
    expect(result.current.loading).toBe(false);
  });

  it('retries only the failed key and clears the error before the retry result', async () => {
    const boom = new Error('first attempt failed');
    const fetcher = vi.fn()
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce({ n: 2 });
    const { result } = renderHook(() => useCachedResource('k', fetcher));

    await waitFor(() => expect(result.current.error).toBe(boom));
    act(() => { result.current.retry(); });
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(dataCache.get('k')).toEqual({ n: 2 });
  });

  it('clears an earlier key error when switching keys', async () => {
    const firstError = new Error('first key failed');
    const fetcher = vi.fn((value?: string) =>
      value === 'second' ? Promise.resolve({ value }) : Promise.reject(firstError));
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useCachedResource(value, () => fetcher(value)),
      { initialProps: { value: 'first' } },
    );

    await waitFor(() => expect(result.current.error).toBe(firstError));
    rerender({ value: 'second' });
    await waitFor(() => expect(result.current.data).toEqual({ value: 'second' }));
    expect(result.current.error).toBeNull();
  });
});

describe('useCachedResource initialData', () => {
  beforeEach(() => {
    dataCache.clear();
  });

  it('seeds the cache and skips loading when initialData is provided on a cache miss', () => {
    const fetcher = vi.fn().mockResolvedValue({ people: [] });
    const { result } = renderHook(() =>
      useCachedResource('people:list:owner=1', fetcher, {
        key: 'people:list:owner=1',
        data: { people: ['seeded'] },
      })
    );

    expect(result.current.data).toEqual({ people: ['seeded'] });
    expect(result.current.loading).toBe(false);
  });

  it('does not override an existing cache entry with initialData', () => {
    dataCache.set('people:list:owner=1', { people: ['already-cached'] });
    const fetcher = vi.fn().mockResolvedValue({ people: [] });
    const { result } = renderHook(() =>
      useCachedResource('people:list:owner=1', fetcher, {
        key: 'people:list:owner=1',
        data: { people: ['seeded'] },
      })
    );

    expect(result.current.data).toEqual({ people: ['already-cached'] });
  });

  it('behaves exactly as before when initialData is omitted (existing call sites)', () => {
    const fetcher = vi.fn().mockResolvedValue({ people: ['fetched'] });
    const { result } = renderHook(() => useCachedResource('people:list:owner=1', fetcher));

    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
  });

  // Regression: the server-rendered seed belongs to exactly ONE owner's key. When
  // the user switches to a shared tree the component stays mounted, `initial` is
  // unchanged, and only `key` changes — the seed must NOT follow the new key, or
  // the owner's own people get written into (and rendered for) the shared tree.
  it('never seeds a key other than the one the initial data was fetched for', async () => {
    const fetcher = vi.fn().mockResolvedValue({ people: ['shared-tree'] });
    const initial = { key: 'people:list:owner=1', data: { people: ['own-tree'] } };

    const { result, rerender } = renderHook(
      ({ ownerId }: { ownerId: number }) =>
        useCachedResource(`people:list:owner=${ownerId}`, fetcher, initial),
      { initialProps: { ownerId: 1 } }
    );
    expect(result.current.data).toEqual({ people: ['own-tree'] });

    // Switch to a shared tree owned by someone else.
    rerender({ ownerId: 999 });

    expect(dataCache.get('people:list:owner=999')).toBeUndefined();
    expect(result.current.data).not.toEqual({ people: ['own-tree'] });
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.data).toEqual({ people: ['shared-tree'] }));
  });
});
