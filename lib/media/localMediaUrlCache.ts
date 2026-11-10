/**
 * Refcounted object-URL cache for the local (PGlite) media path. `useMediaUrl`
 * mounts one entry per `mediaId:ownerId:variant` and shares the object URL — and
 * the in-flight blob read — across every consumer (50 People-list rows, revisits
 * after navigation). The URL is created once per key.
 *
 * When the last live consumer of a key unmounts the entry is NOT revoked
 * immediately — it is kept in a small LRU of `RETENTION_CAP` recently-used URLs.
 * A revisit (Back nav, switching people/users, re-open) then resurrects the warm
 * URL synchronously via `peekObjectUrl`, so the image paints on the first render
 * with no PGlite re-read and no blank/white flash. A URL is only revoked when it
 * is evicted from the LRU (or on an explicit reset), which bounds memory to the
 * cap's worth of retained blobs.
 *
 * Safe because keys are content-stable: MediaBlob is insert-only and MediaThumb
 * upserts ON CONFLICT DO NOTHING, and replacing a photo creates a new MediaId
 * (new key). A retained URL therefore never serves stale bytes for its key.
 */

/**
 * Refcount cache key for a (media, tree, size-variant) blob. Exported so the
 * hook and the prefetcher (`warmThumbnails`) name the same entry — a warm under
 * a different key is a wasted read that leaves the real one cold.
 *
 * The variant threshold mirrors the local client's thumb-vs-full split at 256.
 */
export function objectUrlKey(mediaId: number, treeId: number | null, width?: number): string {
  const variant = width != null && width <= 256 ? 'thumb' : 'full';
  return `${mediaId}:${treeId ?? 'null'}:${variant}`;
}

type Entry = { promise: Promise<string>; url: string | null; refCount: number };
const cache = new Map<string, Entry>();
// Keys with refCount 0, in LRU order (oldest first). A retained entry keeps its
// object URL alive so a revisit is a warm hit instead of a cold PGlite read.
const retained = new Set<string>();
const RETENTION_CAP = 24;

/** Revoke a key's URL and drop it entirely from the cache + LRU. */
function evict(key: string): void {
  const entry = cache.get(key);
  cache.delete(key);
  retained.delete(key);
  entry?.promise.then((url) => URL.revokeObjectURL(url)).catch(() => {});
}

/**
 * Synchronously read the already-resolved object URL for `key` without taking a
 * reference. Returns null if the entry is absent or its blob is still loading.
 * Lets a consumer paint a warm cache hit on its first render — no null tick, no
 * flash of the loading state on a revisit. The caller must still `acquireObjectUrl`
 * (e.g. in an effect) to hold a reference and lift the entry out of the LRU.
 */
export function peekObjectUrl(key: string): string | null {
  return cache.get(key)?.url ?? null;
}

/** Acquire (and refcount) a shared object URL for `key`, loading it once via `loader`. */
export function acquireObjectUrl(key: string, loader: () => Promise<string>): Promise<string> {
  let entry = cache.get(key);
  if (!entry) {
    entry = { promise: null as unknown as Promise<string>, url: null, refCount: 0 };
    entry.promise = loader().then((url) => {
      entry!.url = url;
      return url;
    });
    cache.set(key, entry);
  }
  // Re-acquiring a retained (refCount 0) entry lifts it back out of the LRU.
  retained.delete(key);
  entry.refCount++;
  return entry.promise;
}

/**
 * Release one reference. When the last consumer leaves, the entry is retained in
 * the LRU (URL kept alive) rather than revoked, so a revisit is a warm hit. The
 * oldest entries beyond `RETENTION_CAP` are evicted (and their URLs revoked).
 */
export function releaseObjectUrl(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    // Move to the newest slot of the LRU (re-insert to reorder).
    retained.delete(key);
    retained.add(key);
    // Evict oldest retained entries past the cap.
    while (retained.size > RETENTION_CAP) {
      const oldest = retained.values().next().value as string | undefined;
      if (oldest === undefined) break;
      evict(oldest);
    }
  }
}

/**
 * Drop a cached entry so a later acquire retries the underlying read. This is
 * intentionally separate from release: a failed promise has no URL to retain,
 * and must not poison every future render of the same media.
 */
export function invalidateObjectUrl(key: string): void {
  evict(key);
}

/** TEST ONLY: drop all cached URLs (no revoke — keeps test isolation synchronous). */
export function __resetObjectUrlCache(): void {
  cache.clear();
  retained.clear();
}
