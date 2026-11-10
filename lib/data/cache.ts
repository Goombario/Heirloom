/**
 * Module-level in-memory read-through cache. Persists across client-side
 * navigations (the module is shared) and resets on a full page reload. Values
 * are stored opaquely; callers own key construction (must include treeId).
 */
const store = new Map<string, unknown>();

// Bumped on every clear(). A background revalidation captures the generation at
// fetch-start and only writes its result back if the generation is unchanged on
// resolve — otherwise a write that cleared the cache mid-flight would be undone by
// the now-stale in-flight response repopulating it. See useCachedResource.
let generation = 0;
// Writes through the data client that haven't resolved yet. A write's changes
// are visible before it resolves (and bumps the generation), so results kept
// until the next write must not be reused or kept meanwhile (memo-until-write.ts).
let writesInFlight = 0;

export const dataCache = {
  get<T>(key: string): T | undefined {
    return store.get(key) as T | undefined;
  },
  set<T>(key: string, value: T): void {
    store.set(key, value);
  },
  has(key: string): boolean {
    return store.has(key);
  },
  /** Monotonic counter; changes whenever the cache is cleared. */
  generation(): number {
    return generation;
  },
  /** Whether a write through the data client is still running. */
  writing(): boolean {
    return writesInFlight > 0;
  },
  writeStarted(): void {
    writesInFlight++;
  },
  writeEnded(): void {
    writesInFlight = Math.max(0, writesInFlight - 1);
  },
  /** Coarse invalidation — called after any write (see cache-invalidation.ts). */
  clear(): void {
    store.clear();
    generation++;
  },
};
