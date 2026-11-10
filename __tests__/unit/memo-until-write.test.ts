import { describe, expect, it, vi } from 'vitest';
import { memoUntilWrite } from '@/lib/data/local/memo-until-write';
import { dataCache } from '@/lib/data/cache';
import { withCacheInvalidation } from '@/lib/data/cache-invalidation';
import type { DataClient } from '@/lib/data/types';

describe('memoUntilWrite (#1269)', () => {
  it('keeps a result until the next write', async () => {
    const memo = memoUntilWrite<number, string>();
    const load = vi.fn(async () => 'tree');
    await memo.get(1, load);
    await memo.get(1, load);
    expect(load).toHaveBeenCalledTimes(1);
    dataCache.clear();
    await memo.get(1, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('neither reuses nor keeps a result while a write is running', async () => {
    const memo = memoUntilWrite<number, string>();
    const load = vi.fn(async () => 'tree');
    await memo.get(1, load);
    let finish!: () => void;
    const client = withCacheInvalidation({
      people: { update: () => new Promise<void>((r) => { finish = r; }) },
    } as unknown as DataClient);
    const write = (client.people as unknown as { update(): Promise<void> }).update();
    expect(dataCache.writing()).toBe(true);
    await memo.get(1, load);
    await memo.get(1, load);
    expect(load).toHaveBeenCalledTimes(3);
    finish();
    await write;
    expect(dataCache.writing()).toBe(false);
  });

  it('ends the write, and clears, when a write fails', async () => {
    const memo = memoUntilWrite<number, string>();
    const load = vi.fn(async () => 'tree');
    await memo.get(1, load);
    const client = withCacheInvalidation({
      people: { update: async () => { throw new Error('nope'); } },
    } as unknown as DataClient);
    await expect((client.people as unknown as { update(): Promise<void> }).update()).rejects.toThrow('nope');
    expect(dataCache.writing()).toBe(false);
    await memo.get(1, load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
