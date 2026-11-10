'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getDataClient } from '@/lib/data';
import { useErrorToast } from '@/app/components/useErrorToast';
import type { SourceWithCitationCount } from '@/lib/db/queries/sources';
import type { MediaWithPerson } from '@/lib/db/schema';

export interface UseLibrarySourcesResult {
  sources: SourceWithCitationCount[];
  photos: MediaWithPerson[];
  loading: boolean;
  photoLoading: boolean;
  /** Backwards-compatible alias for the source error. */
  error: unknown;
  sourceError: unknown;
  photoError: unknown;
  retrySources: () => Promise<void>;
  retryPhotos: () => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * Loads the library source list and photo list for a tree scope (null = the
 * current user's default tree). Keeps both in sync after the window regains
 * focus (so counts stay accurate after navigating away to create a source and
 * returning) without replacing already loaded content during revalidation.
 * `enabled` gates the fetches until the user is resolved.
 *
 * Extracted from `app/library/page.tsx`.
 */
export function useLibrarySources(treeId: number | null, enabled: boolean): UseLibrarySourcesResult {
  const scopeKey = enabled ? String(treeId ?? 'default') : 'disabled';
  const [sources, setSources] = useState<SourceWithCitationCount[]>([]);
  const [photos, setPhotos] = useState<MediaWithPerson[]>([]);
  const [sourcesKey, setSourcesKey] = useState(scopeKey);
  const [photosKey, setPhotosKey] = useState(scopeKey);
  const [sourceError, setSourceError] = useState<unknown>(null);
  const [photoError, setPhotoError] = useState<unknown>(null);
  const [sourceErrorKey, setSourceErrorKey] = useState<string | null>(null);
  const [photoErrorKey, setPhotoErrorKey] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [photoLoading, setPhotoLoading] = useState(true);
  const sourceGeneration = useRef(0);
  const photoGeneration = useRef(0);
  const { redirectIfUnauthorized } = useErrorToast();

  const fetchSources = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!enabled) return;
    const generation = ++sourceGeneration.current;
    // Focus revalidation should not replace the rendered Library with its
    // skeleton. Browsers can emit focus after an idle period when the user
    // clicks back into the page, which otherwise looks like a full reload.
    if (!background) setSourceLoading(true);
    setSourceError(null);
    setSourceErrorKey(null);
    try {
      const client = await getDataClient();
      const { sources: loaded } = await client.sources.list<SourceWithCitationCount>({
        withCounts: true,
        treeId,
      });
      if (generation !== sourceGeneration.current) return;
      setSources(loaded);
      setSourcesKey(scopeKey);
    } catch (err) {
      if (redirectIfUnauthorized(err)) return;
      if (generation === sourceGeneration.current) {
        setSourceError(err);
        setSourceErrorKey(scopeKey);
      }
    } finally {
      if (generation === sourceGeneration.current) setSourceLoading(false);
    }
  }, [treeId, enabled, redirectIfUnauthorized, scopeKey]);

  const fetchPhotos = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!enabled) return;
    const generation = ++photoGeneration.current;
    // A background refresh keeps the grid (and an open lightbox) mounted (#802).
    if (!background) setPhotoLoading(true);
    setPhotoError(null);
    setPhotoErrorKey(null);
    try {
      const client = await getDataClient();
      const { media } = await client.media.list<MediaWithPerson>({
        treeId,
        withPerson: true,
      });
      if (generation !== photoGeneration.current) return;
      setPhotos(media);
      setPhotosKey(scopeKey);
    } catch (err) {
      if (redirectIfUnauthorized(err)) return;
      if (generation === photoGeneration.current) {
        setPhotoError(err);
        setPhotoErrorKey(scopeKey);
      }
    } finally {
      if (generation === photoGeneration.current) setPhotoLoading(false);
    }
  }, [treeId, enabled, redirectIfUnauthorized, scopeKey]);

  // Load sources and photos up front so every tab count (including Photos) is
  // accurate without having to open the tab first.
  useEffect(() => {
    if (enabled) {
      void fetchSources();
      void fetchPhotos();
    } else {
      sourceGeneration.current += 1;
      photoGeneration.current += 1;
    }
  }, [enabled, fetchSources, fetchPhotos]);

  // Refetch sources whenever the window regains focus so tab counts stay in
  // sync after creating a source on /library/new and navigating back.
  useEffect(() => {
    function onFocus() {
      if (enabled) void fetchSources({ background: true });
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled, fetchSources]);

  const refetch = useCallback(async () => {
    // After a change the list is already on screen: refresh it in place. A
    // foreground load swaps the page for its skeleton, which unmounts an open
    // source and loses its state (the "Cite on…" result line, #799).
    await Promise.all([fetchSources({ background: true }), fetchPhotos({ background: true })]);
  }, [fetchSources, fetchPhotos]);

  return {
    sources: sourcesKey === scopeKey ? sources : [],
    photos: photosKey === scopeKey ? photos : [],
    // The page's existing skeleton is keyed to the primary source list. Photo
    // loading remains independent; callers can use photoError/retryPhotos without
    // delaying source-tab rendering.
    loading: sourceLoading || sourcesKey !== scopeKey,
    photoLoading: photoLoading || photosKey !== scopeKey,
    error: sourceErrorKey === scopeKey ? sourceError : null,
    sourceError: sourceErrorKey === scopeKey ? sourceError : null,
    photoError: photoErrorKey === scopeKey ? photoError : null,
    retrySources: fetchSources,
    retryPhotos: fetchPhotos,
    refetch,
  };
}
