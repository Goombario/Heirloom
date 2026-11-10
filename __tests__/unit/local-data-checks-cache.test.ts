import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadDataChecks = vi.fn();
vi.mock('@/lib/services/data-checks', () => ({
  loadDataChecks: (treeId: number) => loadDataChecks(treeId),
  // The real service resolves the scope, then loads; tree 1 stands in for that.
  listDataChecksService: async (_params: unknown, load: (treeId: number) => Promise<unknown>) => load(1),
  dataCheckNeighbourhoodService: async (_params: unknown, load: (treeId: number) => Promise<{ input: unknown }>) => (await load(1)).input,
  confirmDataCheckService: vi.fn(),
  reopenDataCheckService: vi.fn(),
}));
vi.mock('@/lib/data/local-user', () => ({ ensureLocalUser: async () => 1 }));

import { LocalDataChecksClient, __resetDataCheckSnapshots } from '@/lib/data/local/data-checks';
import { dataCache } from '@/lib/data/cache';
import { isReadMethod } from '@/lib/data/cache-invalidation';

const snapshot = { input: { people: [] }, names: [], confirmations: [], problems: [] };

describe('local data checks cache (#1269)', () => {
  beforeEach(() => {
    __resetDataCheckSnapshots();
    loadDataChecks.mockReset();
    loadDataChecks.mockResolvedValue(snapshot);
  });

  it('runs the whole-tree checks once for repeated lists', async () => {
    const client = new LocalDataChecksClient();
    await client.list(null, { personId: 5 });
    await client.list(null, { personId: 6 });
    await client.neighbourhood(5);
    expect(loadDataChecks).toHaveBeenCalledTimes(1);
  });

  it('shares one load between overlapping calls', async () => {
    const client = new LocalDataChecksClient();
    await Promise.all([client.list(null, { personId: 5 }), client.list(null, { personId: 5 })]);
    expect(loadDataChecks).toHaveBeenCalledTimes(1);
  });

  it('runs them again after a write clears the cache', async () => {
    const client = new LocalDataChecksClient();
    await client.list(null, { personId: 5 });
    dataCache.clear();
    await client.list(null, { personId: 5 });
    expect(loadDataChecks).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed load', async () => {
    loadDataChecks.mockRejectedValueOnce(new Error('boom'));
    const client = new LocalDataChecksClient();
    await expect(client.list(null, { personId: 5 })).rejects.toThrow('boom');
    await expect(client.list(null, { personId: 5 })).resolves.toBe(snapshot);
    expect(loadDataChecks).toHaveBeenCalledTimes(2);
  });

  it('treats neighbourhood as a read, so it keeps the cache', () => {
    expect(isReadMethod('neighbourhood')).toBe(true);
  });
});
