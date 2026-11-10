import { StorageLimitError } from '@/lib/data/errors';

/**
 * Checks whether a browser's reported local-storage estimate can accommodate
 * an incoming file. Browsers are allowed to omit or reject this API, so an
 * unavailable estimate is intentionally treated as inconclusive.
 */
export async function assertBrowserStorageCapacity(incomingBytes: number): Promise<void> {
  if (!Number.isFinite(incomingBytes) || incomingBytes < 0) {
    throw new TypeError('Incoming storage size must be a finite, non-negative number');
  }

  const storage = globalThis.navigator?.storage;
  const estimate = storage?.estimate;
  if (typeof estimate !== 'function') return;

  let value: StorageEstimate;
  try {
    value = await estimate.call(storage);
  } catch {
    return;
  }

  if (!Number.isFinite(value?.quota) || !Number.isFinite(value?.usage)) return;

  const availableBytes = Math.max(0, value.quota! - value.usage!);
  if (incomingBytes > availableBytes) {
    throw new StorageLimitError();
  }
}
