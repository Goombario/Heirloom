import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dataCache } from '@/lib/data/cache';
import { withCacheInvalidation } from '@/lib/data/cache-invalidation';

function makeFakeClient() {
  return {
    people: {
      list: vi.fn(async () => ({ people: [], count: 0 })),
      get: vi.fn(async () => ({ Id: 1 })),
      create: vi.fn(async () => ({ Id: 2 })),
      update: vi.fn(async () => ({ Id: 1 })),
      remove: vi.fn(async () => undefined),
    },
  } as unknown as import('@/lib/data/types').DataClient;
}

describe('withCacheInvalidation', () => {
  beforeEach(() => dataCache.clear());

  it('leaves read methods alone (cache not cleared)', async () => {
    const client = withCacheInvalidation(makeFakeClient());
    dataCache.set('x', 1);
    await client.people.list();
    await client.people.get(1);
    expect(dataCache.has('x')).toBe(true);
  });

  it('clears the cache after a write resolves', async () => {
    const client = withCacheInvalidation(makeFakeClient());
    dataCache.set('x', 1);
    await client.people.create({});
    expect(dataCache.has('x')).toBe(false);
  });

  it("leaves the cache alone for the account client's writes (#35)", async () => {
    const setLastSeenVersion = vi.fn(async () => undefined);
    const client = withCacheInvalidation({ account: { setLastSeenVersion } } as unknown as import('@/lib/data/types').DataClient);
    dataCache.set('x', 1);
    await client.account.setLastSeenVersion('1.1.0');
    expect(setLastSeenVersion).toHaveBeenCalledWith('1.1.0');
    expect(dataCache.has('x')).toBe(true);
  });

  it('clears after update and remove too', async () => {
    const client = withCacheInvalidation(makeFakeClient());
    dataCache.set('x', 1);
    await client.people.update(1, {});
    expect(dataCache.has('x')).toBe(false);
    dataCache.set('y', 1);
    await client.people.remove(1);
    expect(dataCache.has('y')).toBe(false);
  });

  // Table-driven guard: a method is a write (invalidates) unless it's a known
  // read. `linkMedia`/`unlinkMedia` match no "write verb" and were silently
  // skipped before the read-allowlist flip — keep them covered.
  const READS = ['list', 'get', 'search', 'detail', 'suggestFamily', 'suggestions',
    'listNameVariants', 'listTags', 'getFile', 'citedBy', 'listForPerson', 'listForFamily',
    'listForFact', 'listMediaLibrary', 'previewGedcom', 'previewSpreadsheet',
    'dependentCount', 'pinChains'];
  const WRITES = ['create', 'update', 'remove', 'addChild', 'addComment',
    'updateChildType', 'removeChild', 'setPrimaryNameVariant', 'createTag',
    'removeTag', 'upload', 'importGedcom', 'reset', 'revert',
    'linkMedia', 'unlinkMedia'];

  function clientWith(methods: string[]) {
    const sub = Object.fromEntries(methods.map((m) => [m, vi.fn(async () => ({}))]));
    return withCacheInvalidation({ entity: sub } as unknown as import('@/lib/data/types').DataClient);
  }

  it.each(READS)('read method %s does NOT clear the cache', async (name) => {
    const client = clientWith([name]) as unknown as Record<string, Record<string, () => Promise<unknown>>>;
    dataCache.set('x', 1);
    await client.entity[name]();
    expect(dataCache.has('x')).toBe(true);
  });

  it.each(WRITES)('write method %s clears the cache', async (name) => {
    const client = clientWith([name]) as unknown as Record<string, Record<string, () => Promise<unknown>>>;
    dataCache.set('x', 1);
    await client.entity[name]();
    expect(dataCache.has('x')).toBe(false);
  });
});
