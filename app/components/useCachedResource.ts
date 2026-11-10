'use client';

import { useCallback, useEffect, useState } from 'react';
import { dataCache } from '@/lib/data/cache';

export interface CachedResource<T> {
  data: T | undefined;
  loading: boolean;
  error: unknown;
  retry: () => void;
}

/**
 * A server-rendered first value, paired with the cache key it was fetched for.
 * The pairing is the point: a Server Component fetches one specific owner's
 * data, so the seed is only ever valid for that owner's key.
 */
export interface InitialData<T> {
  key: string;
  data: T;
}

/**
 * Read-through cache hook. On a cache hit returns the value synchronously with
 * loading=false and revalidates in the background (stale-while-revalidate). On a
 * miss, loading=true until the fetcher resolves. Pass key=null to skip (e.g.
 * before the tree scope is known). Key MUST encode treeId + params.
 *
 * `initial`, when provided, seeds the cache on a miss only — it never overwrites
 * an existing entry, and it only ever seeds `initial.key`. Intended for a
 * server-provided first value (e.g. a Server Component's initial fetch) so the
 * first client render skips its own network round-trip entirely.
 *
 * The key check is load-bearing, not defensive: this component stays mounted
 * across a tree switch, so `key` changes while `initial` does not. Seeding
 * whatever `key` happens to be current would write the owner's own data into a
 * *shared* tree's cache entry and render it as that tree's.
 */
export function useCachedResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  initial?: InitialData<T>,
): CachedResource<T> {
  // Idempotent per key (a no-op once seeded), so running during render — and
  // possibly twice under StrictMode/concurrent rendering — is safe.
  if (key && initial && initial.key === key && dataCache.get<T>(key) === undefined) {
    dataCache.set(key, initial.data);
  }

  const cached = key ? dataCache.get<T>(key) : undefined;
  const [data, setData] = useState<T | undefined>(cached);
  // The key `data` was read for. Between a key change (a tree switch) and the
  // effect below, the old key's data must not be handed out under the new key:
  // the page would render the old tree's records with the new tree's id and ask
  // for, say, the old tree's photo from the new tree (#1232).
  const [dataKey, setDataKey] = useState<string | null>(key);
  const [loading, setLoading] = useState<boolean>(key ? cached === undefined : false);
  const [error, setError] = useState<unknown>(null);
  const [retryToken, setRetryToken] = useState(0);

  // Keep retries local to this hook instance. Clearing the error before the
  // effect runs prevents a failed read from remaining visible while the same
  // key is being tried again; stale data remains available during revalidation.
  const retry = useCallback(() => {
    setError(null);
    setLoading(data === undefined);
    setRetryToken((token) => token + 1);
  }, [data]);

  useEffect(() => {
    setDataKey(key);
    if (!key) {
      setData(undefined);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const hit = dataCache.get<T>(key);
    setData(hit);
    setLoading(hit === undefined);
    setError(null);
    const startedAt = dataCache.generation();
    fetcher()
      .then((res) => {
        if (cancelled) return;
        // Only repopulate the shared cache if no write cleared it while this fetch
        // was in flight; otherwise this (possibly pre-write) result would undo the
        // invalidation. The local state still updates — that's this component's own
        // view, and it self-heals on the next mount against the cleared cache.
        if (dataCache.generation() === startedAt) dataCache.set(key, res);
        setData(res);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // fetcher is intentionally excluded — callers pass a fresh closure each render;
    // key is the identity that should retrigger a fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retryToken]);

  if (dataKey !== key) return { data: cached, loading: key ? cached === undefined : false, error: null, retry };
  return { data, loading, error, retry };
}
