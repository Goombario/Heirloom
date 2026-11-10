import { dataCache } from '../cache';

export interface MemoUntilWrite<K, V> {
  /** The key's remembered result, or `load()`'s, which is then remembered. */
  get(key: K, load: () => Promise<V>): Promise<V>;
  /** Forget everything (tests). */
  reset(): void;
}

/**
 * Remember each key's result until the next write (#1269). Every write through
 * the data client bumps the cache generation (cache-invalidation.ts), so the
 * first call after an edit, import or delete loads again. Overlapping calls
 * share one load, and a failed load isn't kept. While a write is running
 * nothing is reused or kept: its changes show before it resolves. A restore
 * reloads the page, which starts this empty.
 */
export function memoUntilWrite<K, V>(): MemoUntilWrite<K, V> {
  const entries = new Map<K, { generation: number; value: Promise<V> }>();
  return {
    get(key, load) {
      // Mid-write, the database may already differ from what was kept.
      if (dataCache.writing()) return load();
      const generation = dataCache.generation();
      const hit = entries.get(key);
      if (hit && hit.generation === generation) return hit.value;
      const value = load();
      entries.set(key, { generation, value });
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
    reset() {
      entries.clear();
    },
  };
}
