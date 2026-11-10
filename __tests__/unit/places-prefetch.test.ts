import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dataCache } from '@/lib/data/cache';
import { placeDetailKey, prefetchPlaceDetail } from '@/lib/places/prefetch';
import type { PlaceDetail } from '@/lib/data/types';

const detailMock = vi.fn();

vi.mock('@/lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data')>();
  return {
    ...actual,
    getDataClient: async () => ({
      places: { detail: detailMock },
    }),
  };
});

const makeDetail = (name: string): PlaceDetail => ({
  id: 1,
  name,
  displayName: null,
  latitude: null,
  longitude: null,
  form: null,
  people: [],
  eventCount: 0,
  familyCount: 0,
  eventCounts: [],
  children: [],
  parents: [],
} as unknown as PlaceDetail);

describe('placeDetailKey', () => {
  it('builds the tree-scoped cache key shared with PlaceDetailView', () => {
    expect(placeDetailKey(7, 'Boston, MA')).toBe('places:detail:7:Boston, MA');
  });

  it('uses the default scope when treeId is null', () => {
    expect(placeDetailKey(null, 'Boston, MA')).toBe('places:detail:default:Boston, MA');
  });
});

describe('prefetchPlaceDetail', () => {
  beforeEach(() => {
    dataCache.clear();
    detailMock.mockReset();
  });

  it('prefetches the default tree when treeId is null/undefined', async () => {
    const detail = makeDetail('Boston, MA');
    detailMock.mockResolvedValue(detail);
    await prefetchPlaceDetail('Boston, MA', null);
    expect(detailMock).toHaveBeenCalledWith('Boston, MA', null);
    expect(dataCache.get(placeDetailKey(null, 'Boston, MA'))).toEqual(detail);
    // A second call (undefined normalizes to the same default scope) is a cache hit.
    await prefetchPlaceDetail('Boston, MA', undefined);
    expect(detailMock).toHaveBeenCalledTimes(1);
  });

  it('no-ops when name is empty', async () => {
    await prefetchPlaceDetail('', 3);
    expect(detailMock).not.toHaveBeenCalled();
  });

  it('fetches and warms the dataCache under the shared key', async () => {
    const detail = makeDetail('Boston, MA');
    detailMock.mockResolvedValue(detail);
    await prefetchPlaceDetail('Boston, MA', 3);
    expect(detailMock).toHaveBeenCalledWith('Boston, MA', 3);
    expect(dataCache.get(placeDetailKey(3, 'Boston, MA'))).toEqual(detail);
  });

  it('skips the fetch when the key is already cached', async () => {
    dataCache.set(placeDetailKey(3, 'Boston, MA'), makeDetail('Boston, MA'));
    await prefetchPlaceDetail('Boston, MA', 3);
    expect(detailMock).not.toHaveBeenCalled();
  });

  it('swallows fetch failures (best-effort)', async () => {
    detailMock.mockRejectedValue(new Error('network down'));
    await expect(prefetchPlaceDetail('Boston, MA', 3)).resolves.toBeUndefined();
    expect(dataCache.get(placeDetailKey(3, 'Boston, MA'))).toBeUndefined();
  });
});
