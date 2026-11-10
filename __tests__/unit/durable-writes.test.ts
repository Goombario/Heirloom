import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ flush: vi.fn<() => Promise<void>>() }));
vi.mock('@/lib/db/connection.pglite', () => ({ flushToDisk: h.flush }));

import { durableBatch, withDurableWrites } from '@/lib/data/local/durable-writes';
import { StorageLimitError } from '@/lib/data/errors';
import type { DataClient } from '@/lib/data/types';

function makeFakeClient(create = vi.fn(async () => ({ Id: 2 }))) {
  return {
    people: {
      list: vi.fn(async () => ({ people: [], count: 0 })),
      create,
    },
  } as unknown as DataClient;
}

const listeners = new Set<unknown>();

beforeEach(() => {
  h.flush.mockReset();
  h.flush.mockResolvedValue(undefined);
  listeners.clear();
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: unknown) => { if (type === 'beforeunload') listeners.add(fn); },
    removeEventListener: (type: string, fn: unknown) => { if (type === 'beforeunload') listeners.delete(fn); },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('withDurableWrites (#1033)', () => {
  it('resolves a write only after its durable flush', async () => {
    let finishFlush!: () => void;
    h.flush.mockReturnValue(new Promise<void>((resolve) => { finishFlush = resolve; }));
    const client = withDurableWrites(makeFakeClient());

    let done = false;
    const write = client.people.create({} as never).then((r) => { done = true; return r; });
    await vi.waitFor(() => expect(h.flush).toHaveBeenCalledOnce());
    expect(done).toBe(false);
    // Leaving the page while the save is on its way asks first.
    expect(listeners.size).toBe(1);

    finishFlush();
    expect(await write).toEqual({ Id: 2 });
    expect(listeners.size).toBe(0);
  });

  it('leaves reads alone', async () => {
    const client = withDurableWrites(makeFakeClient());
    await client.people.list();
    expect(h.flush).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('fails the write when the flush fails, mapping a full disk to StorageLimitError', async () => {
    h.flush.mockRejectedValue(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));
    const client = withDurableWrites(makeFakeClient());
    await expect(client.people.create({} as never)).rejects.toBeInstanceOf(StorageLimitError);
    expect(listeners.size).toBe(0);
  });

  it('still flushes a failed write, which may have saved part of itself, and reports its own error', async () => {
    h.flush.mockRejectedValue(new Error('flush failed'));
    const client = withDurableWrites(makeFakeClient(vi.fn(async () => { throw new Error('write failed'); })));
    await expect(client.people.create({} as never)).rejects.toThrow('write failed');
    expect(h.flush).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
});

describe('durableBatch (#1259)', () => {
  it('flushes once for a whole loop of writes, after the last one', async () => {
    const create = vi.fn(async () => ({ Id: 2 }));
    const batchClient = makeFakeClient(create);
    let finishFlush!: () => void;
    h.flush.mockReturnValue(new Promise<void>((resolve) => { finishFlush = resolve; }));

    let done = false;
    const batch = durableBatch(batchClient, async (client) => {
      // Leaving the page mid-batch asks first, before any flush has started.
      expect(listeners.size).toBe(1);
      for (let i = 0; i < 5; i++) await client.people.create({} as never);
      expect(h.flush).not.toHaveBeenCalled();
      return 'added';
    }).then((r) => { done = true; return r; });

    await vi.waitFor(() => expect(h.flush).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledTimes(5);
    expect(done).toBe(false);
    finishFlush();
    expect(await batch).toBe('added');
    expect(listeners.size).toBe(0);
  });

  it('flushes what a failed batch saved, then reports the batch error', async () => {
    const batch = durableBatch(makeFakeClient(), async (client) => {
      await client.people.create({} as never);
      throw new Error('third photo failed');
    });
    await expect(batch).rejects.toThrow('third photo failed');
    expect(h.flush).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it('fails the batch with StorageLimitError when the final flush runs out of space', async () => {
    h.flush.mockRejectedValue(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));
    await expect(durableBatch(makeFakeClient(), async (client) => client.people.create({} as never)))
      .rejects.toBeInstanceOf(StorageLimitError);
  });
});
