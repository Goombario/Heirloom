'use client';

/**
 * Thumbnail prefetch for list surfaces that already know which faces they are
 * about to draw.
 *
 * `ProfileImage` only paints after its thumbnail has loaded AND decoded, and
 * `PersonAvatar` shows the initials disc underneath until then. On a surface
 * whose payload arrives in one shot — the places explore panel gets every linked
 * person with the detail fetch — the media reads can start at that moment rather
 * than when each row mounts and its lazy `<img>` enters the viewport. Warming
 * turns the visible initials→photo swap into an already-decoded first paint in
 * the common case.
 *
 * It warms the SAME cache entry the component will later ask for, in both data
 * modes:
 *   - http: an off-screen `Image()` on the exact `/api/media/{id}/file?w=` URL,
 *     so the component's own `<img>` is served from the browser HTTP cache.
 *   - local: `acquireObjectUrl` on the exact key, so the PGlite read happens once
 *     and `useMediaUrl` seeds synchronously from `peekObjectUrl` on first render.
 *
 * Fire-and-forget by design: a failed warm is not an error the UI should show —
 * the component re-requests and surfaces its own failure state.
 */

import { DATA_MODE, getDataClient } from '@/lib/data';
import { focalThumbWidth, mediaFileUrl } from '@/lib/media-url';
import { acquireObjectUrl, releaseObjectUrl, peekObjectUrl, objectUrlKey } from './localMediaUrlCache';

/**
 * Read a media blob and wrap it in an object URL. Shared with `useMediaUrl` so a
 * warm and a mount produce byte-identical entries under the same cache key.
 */
export async function loadMediaObjectUrl(
  mediaId: number,
  treeId: number | null,
  variant: 'thumb' | 'full',
): Promise<string> {
  const client = await getDataClient();
  const { bytes, contentType } =
    variant === 'thumb'
      ? await client.media.getThumb(mediaId, treeId)
      : await client.media.getFile(mediaId, treeId);
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: contentType }));
}

/** One face to warm — the media id plus the focal radius that sets its zoom (and
 *  therefore the thumbnail width the component will request). */
export interface WarmTarget {
  mediaId: number | null | undefined;
  focalRadius?: number | null;
}

export interface WarmOptions {
  /** Avatar diameter in CSS px — must match the `size` the avatars render at. */
  containerWidth: number;
  treeId?: number | null;
  /**
   * How many targets to warm. Deliberately small and BELOW the object-URL LRU's
   * retention cap (24): warming a whole 60-row preview would evict its own
   * earliest entries before those rows ever mounted, so the work would be spent
   * on blobs already thrown away. The first screenful is what the swap is
   * visible on.
   */
  limit?: number;
}

const DEFAULT_LIMIT = 12;

// Urls already handed to an off-screen Image() this session. Without it, every
// re-render of a warming surface would allocate a fresh Image for a URL the
// browser cache already holds. Bounded — this is an optimisation, not a ledger.
const warmedUrls = new Set<string>();
const WARMED_URL_CAP = 256;

/**
 * Start loading the thumbnails these avatars will need. Returns immediately;
 * safe to call repeatedly with the same targets (each is warmed once).
 */
export function warmThumbnails(targets: WarmTarget[], opts: WarmOptions): void {
  // SSR/prerender has no image cache to warm and no `Image` constructor.
  if (typeof window === 'undefined') return;
  const treeId = opts.treeId ?? null;
  const limit = opts.limit ?? DEFAULT_LIMIT;

  let warmed = 0;
  for (const target of targets) {
    if (warmed >= limit) return;
    if (!target.mediaId) continue; // no photo → the initials disc IS the final state
    warmed++;
    const width = focalThumbWidth(opts.containerWidth, target.focalRadius);

    if (DATA_MODE === 'http') {
      const url = mediaFileUrl(target.mediaId, { treeId, width });
      if (warmedUrls.has(url)) continue;
      if (warmedUrls.size >= WARMED_URL_CAP) warmedUrls.clear();
      warmedUrls.add(url);
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      continue;
    }

    const key = objectUrlKey(target.mediaId, treeId, width);
    if (peekObjectUrl(key) !== null) continue; // already resolved and retained
    const variant = width <= 256 ? 'thumb' : 'full';
    const mediaId = target.mediaId;
    // Release only once the read settles. Releasing synchronously would drop the
    // entry into the retention LRU while still in flight, where a later warm
    // could evict (and revoke) it mid-load.
    acquireObjectUrl(key, () => loadMediaObjectUrl(mediaId, treeId, variant))
      .catch(() => {})
      .finally(() => releaseObjectUrl(key));
  }
}
