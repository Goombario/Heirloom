'use client';
import { useCallback, useEffect, useState } from 'react';
import { DATA_MODE } from '@/lib/data';
import { mediaFileUrl } from '@/lib/media-url';
import { acquireObjectUrl, releaseObjectUrl, peekObjectUrl, objectUrlKey, invalidateObjectUrl } from '@/lib/media/localMediaUrlCache';
import { loadMediaObjectUrl } from '@/lib/media/warmThumbnails';

export interface UseMediaUrlOptions {
  /** Tree scope (null = the current user's default tree). */
  treeId?: number | null;
  /**
   * Width hint (CSS px). Http: selects a server thumbnail (`?w=`). Local: a hint
   * `<= 256` reads the small MediaThumb; larger (or unset) reads the full blob.
   */
  width?: number;
}

export interface MediaUrlState {
  /** The <img src>; null while a local blob is still resolving, or on read failure. */
  src: string | null;
  loading: boolean;
  /** True only when a local blob read genuinely failed (vs. still loading). */
  error: boolean;
  /** Re-run the current URL read, evicting any rejected cache entry first. */
  retry: () => void;
  /** Switch a thumbnail request to the original blob, when that is supported. */
  fallback: () => void;
  /** True after the hook has switched from the requested thumbnail to the full blob. */
  usingFullFallback: boolean;
  /** Changes whenever retry needs consumers to remount an image with the same URL. */
  reloadKey: number;
}

/**
 * Resolves a media id to an <img src>. Http: the static /api/media/{id}/file
 * URL, returned synchronously. Local: reads MediaBlob bytes via the data client,
 * wraps them in an object URL, and revokes it on unmount / id change.
 *
 * All hooks run unconditionally before the mode branch so rules-of-hooks holds
 * (DATA_MODE is a build constant, so the branch never changes between renders).
 */
export function useMediaUrl(mediaId: number, opts?: UseMediaUrlOptions): MediaUrlState {
  const treeId = opts?.treeId ?? null;
  const width = opts?.width;
  const baseKey = objectUrlKey(mediaId, treeId, width);
  const [fullFallbackKey, setFullFallbackKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // A thumbnail is the only variant with a useful full-blob fallback. Requests
  // that are already full-size should simply retry the same source.
  const canUseFullFallback = width != null && width <= 256;
  const usingFullFallback = fullFallbackKey === baseKey;
  const requestedWidth = usingFullFallback ? undefined : width;
  const key = objectUrlKey(mediaId, treeId, requestedWidth);
  // The resolved blob URL is TAGGED with the key it belongs to. A mediaId/width
  // change must never surface the PREVIOUS media's URL — that stale URL made
  // ProfileImage paint the old photo under the new person's focal ("crop lag"),
  // because the consumer saw src === the-src-it-already-shows and treated the new
  // person as "settled". Seeded from the warm object-URL cache so a revisit paints
  // on the first render instead of flashing the loading state.
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(() => {
    if (DATA_MODE === 'http') return null;
    const u = peekObjectUrl(key);
    return u ? { key, url: u } : null;
  });
  // Key of a genuine blob-read failure — kept distinct from the still-loading null
  // so a consumer can show a missing-media indicator without flashing it during load.
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const retry = useCallback(() => {
    invalidateObjectUrl(key);
    setResolved(null);
    setFailedKey(null);
    setReloadKey((value) => value + 1);
  }, [key]);

  const fallback = useCallback(() => {
    if (canUseFullFallback && !usingFullFallback) {
      invalidateObjectUrl(key);
      setResolved(null);
      setFailedKey(null);
      setFullFallbackKey(baseKey);
      setReloadKey((value) => value + 1);
      return;
    }
    retry();
  }, [baseKey, canUseFullFallback, key, retry, usingFullFallback]);

  useEffect(() => {
    if (DATA_MODE === 'http') return; // http path is synchronous, no effect
    const variant = requestedWidth != null && requestedWidth <= 256 ? 'thumb' : 'full';
    const k = key;
    let cancelled = false;
    // A warm cache hit is seeded synchronously by the useState initializer above,
    // so the first render already paints it; here we only (re)acquire a reference
    // and pick up the resolved URL when the read completes.
    acquireObjectUrl(k, () => loadMediaObjectUrl(mediaId, treeId, variant))
      .then((url) => { if (!cancelled) setResolved({ key: k, url }); })
      .catch(() => { if (!cancelled) setFailedKey(k); });
    return () => {
      cancelled = true;
      releaseObjectUrl(k);
    };
  }, [mediaId, treeId, requestedWidth, key, reloadKey]);

  if (DATA_MODE === 'http') {
    return {
      src: mediaFileUrl(mediaId, { treeId, width: requestedWidth }),
      loading: false,
      error: false,
      retry,
      fallback,
      usingFullFallback,
      reloadKey,
    };
  }
  // Only trust resolved/failed state that belongs to the CURRENT key; otherwise fall
  // back to a synchronous warm-cache peek (the new blob if retained, else null while
  // it loads) — never the previous media's URL.
  const url = resolved?.key === key ? resolved.url : peekObjectUrl(key);
  const failed = failedKey === key;
  return {
    src: url,
    loading: url === null && !failed,
    error: failed,
    retry,
    fallback,
    usingFullFallback,
    reloadKey,
  };
}
