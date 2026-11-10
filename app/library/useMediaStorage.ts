'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDataClient } from '@/lib/data';
import type { MediaStorageSummary } from '@/lib/data/types';
import { useErrorToast } from '@/app/components/useErrorToast';

export interface UseMediaStorageResult {
  summary: MediaStorageSummary | null;
  loading: boolean;
  error: unknown;
  retry: () => Promise<void>;
  refresh: () => Promise<void>;
}

/** Loads storage independently from the photo list so a quota failure never hides photos. */
export function useMediaStorage(treeId: number | null, enabled: boolean): UseMediaStorageResult {
  const scopeKey = enabled ? String(treeId ?? 'default') : 'disabled';
  const [summary, setSummary] = useState<MediaStorageSummary | null>(null);
  const [summaryKey, setSummaryKey] = useState(scopeKey);
  const [error, setError] = useState<unknown>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const { redirectIfUnauthorized } = useErrorToast();

  const fetchSummary = useCallback(async () => {
    if (!enabled) return;
    const requestGeneration = ++generation.current;
    setLoading(true);
    setError(null);
    setErrorKey(null);
    try {
      const client = await getDataClient();
      const loaded = await client.media.getStorageSummary(treeId);
      if (requestGeneration !== generation.current) return;
      setSummary(loaded);
      setSummaryKey(scopeKey);
    } catch (err) {
      if (redirectIfUnauthorized(err)) return;
      if (requestGeneration === generation.current) {
        setError(err);
        setErrorKey(scopeKey);
      }
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [enabled, redirectIfUnauthorized, scopeKey, treeId]);

  useEffect(() => {
    if (enabled) {
      void fetchSummary();
    } else {
      generation.current += 1;
      setSummary(null);
      setSummaryKey(scopeKey);
      setError(null);
      setErrorKey(null);
      setLoading(false);
    }
  }, [enabled, fetchSummary, scopeKey]);

  return {
    summary: summaryKey === scopeKey ? summary : null,
    loading: enabled && (loading || summaryKey !== scopeKey),
    error: errorKey === scopeKey ? error : null,
    retry: fetchSummary,
    refresh: fetchSummary,
  };
}
