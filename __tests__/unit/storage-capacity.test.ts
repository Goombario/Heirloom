import { afterEach, describe, expect, it, vi } from 'vitest';
import { asStorageLimitError, StorageLimitError } from '@/lib/data/errors';
import { assertBrowserStorageCapacity } from '@/lib/media/storage-capacity';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubEstimate(value: StorageEstimate): ReturnType<typeof vi.fn> {
  const estimate = vi.fn().mockResolvedValue(value);
  vi.stubGlobal('navigator', { storage: { estimate } });
  return estimate;
}

describe('assertBrowserStorageCapacity', () => {
  it('allows an incoming file when the remaining estimate is sufficient', async () => {
    stubEstimate({ quota: 100, usage: 20 });

    await expect(assertBrowserStorageCapacity(70)).resolves.toBeUndefined();
  });

  it('allows an incoming file exactly equal to the remaining estimate', async () => {
    stubEstimate({ quota: 100, usage: 20 });

    await expect(assertBrowserStorageCapacity(80)).resolves.toBeUndefined();
  });

  it('throws StorageLimitError when the incoming file exceeds remaining estimate', async () => {
    stubEstimate({ quota: 100, usage: 20 });

    await expect(assertBrowserStorageCapacity(81)).rejects.toBeInstanceOf(StorageLimitError);
  });

  it('throws when reported usage is already over quota', async () => {
    stubEstimate({ quota: 100, usage: 120 });

    await expect(assertBrowserStorageCapacity(1)).rejects.toBeInstanceOf(StorageLimitError);
  });

  it('proceeds when the storage estimate API is unavailable', async () => {
    vi.stubGlobal('navigator', {});

    await expect(assertBrowserStorageCapacity(10_000_000)).resolves.toBeUndefined();
  });

  it('proceeds when the storage estimate is rejected', async () => {
    const estimate = vi.fn().mockRejectedValue(new Error('estimate unavailable'));
    vi.stubGlobal('navigator', { storage: { estimate } });

    await expect(assertBrowserStorageCapacity(10_000_000)).resolves.toBeUndefined();
  });

  it.each([
    { quota: undefined, usage: 10 },
    { quota: 100, usage: undefined },
    { quota: Number.NaN, usage: 10 },
    { quota: 100, usage: Number.POSITIVE_INFINITY },
  ])('proceeds when quota or usage is not a finite number: $quota/$usage', async (value) => {
    stubEstimate(value);

    await expect(assertBrowserStorageCapacity(10_000_000)).resolves.toBeUndefined();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid incoming bytes: %s', async (incomingBytes) => {
    const estimate = stubEstimate({ quota: 100, usage: 20 });

    await expect(assertBrowserStorageCapacity(incomingBytes)).rejects.toThrow(TypeError);
    expect(estimate).not.toHaveBeenCalled();
  });
});

describe('asStorageLimitError', () => {
  it('preserves an existing StorageLimitError', () => {
    const error = new StorageLimitError();

    expect(asStorageLimitError(error)).toBe(error);
  });

  it.each([
    { name: 'QuotaExceededError' },
    { name: 'NS_ERROR_DOM_QUOTA_REACHED' },
    { code: 22 },
    { code: 1014 },
  ])('maps browser quota failures: %o', (error) => {
    expect(asStorageLimitError(error)).toBeInstanceOf(StorageLimitError);
  });

  it('does not convert unrelated database failures', () => {
    const error = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });

    expect(asStorageLimitError(error)).toBeNull();
    expect(error).not.toBeInstanceOf(StorageLimitError);
  });

  it('does not convert arbitrary errors that happen to mention quota', () => {
    expect(asStorageLimitError(new Error('quota check failed'))).toBeNull();
  });
});
