'use client';
import { useState, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { focalThumbWidth, withThumbWidth } from '@/lib/media-url';
import { useMediaUrl } from '@/lib/media/useMediaUrl';

// Off-screen 1×1 loader: loads + decodes the next blob without painting or
// affecting layout, then promotes it to the visible layer (decode-before-swap).
const HIDDEN_LOADER_STYLE: CSSProperties = {
    position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none',
};

interface ProfileImageProps {
    mediaId: number;
    treeId?: number | null;
    alt: string;
    focalX?: number;
    focalY?: number;
    focalRadius?: number | null; // % of min(nW,nH)/2; null = no crop, use object-cover
    containerWidth: number;
    containerHeight: number;
    circular?: boolean;
    className?: string;
    /** Override the auto-derived thumbnail width (in CSS pixels). */
    thumbSize?: number;
    /** Defaults to 'lazy'. Pass 'eager' for above-the-fold heroes. */
    loading?: 'lazy' | 'eager';
}

/**
 * Profile image with zoom-crop based on focal point and radius.
 *
 * FocalX/FocalY: 0-100, center of the selected crop area as % of image dimensions.
 * FocalRadius: percentage (0-100+) of the image's min-dimension half-radius.
 *   - null / undefined = no crop set; falls back to object-cover + objectPosition
 *   - 100 = crop circle radius equals min(nW, nH) / 2 (full short-side half-radius)
 *
 * For circular containers: the crop circle fills the container circle (use Math.min).
 * For rectangular containers: the crop fills the full container (use Math.max).
 *
 * Rendering strategy: image at natural dimensions + CSS transform: translate() scale()
 * to center the focal point and zoom. GPU-composited, avoids object-position clamping.
 */
export default function ProfileImage({
    mediaId,
    treeId,
    alt,
    focalX = 50,
    focalY = 50,
    focalRadius,
    containerWidth,
    containerHeight,
    circular = true,
    className = '',
    thumbSize,
    loading = 'lazy',
}: ProfileImageProps) {
    // Target thumbnail width, computed independent of `src` so it can drive
    // useMediaUrl's local thumb-vs-full selection. The rule lives in
    // `focalThumbWidth` so `warmThumbnails` can prefetch the SAME variant this
    // component will ask for (a warm at another width is a different cache key
    // in both modes, and would leave the real request cold).
    const snapped = useMemo(
        () => focalThumbWidth(containerWidth, focalRadius, thumbSize),
        [thumbSize, containerWidth, focalRadius],
    );

    // Local: snapped <= 256 → getThumb (small blob); larger → getFile (full).
    // Http: the snapped width rides on the URL as ?w=.
    const { src, error: mediaError } = useMediaUrl(mediaId, { treeId, width: snapped });

    // withThumbWidth is a no-op on a local blob: URL; on http it sets ?w=snapped.
    const effectiveSrc = useMemo(
        () => (src ? withThumbWidth(src, snapped) : null),
        [src, snapped],
    );
    // Pure focal → CSS style, computed from the image's natural dimensions. Kept
    // side-effect-free so it can run at decode time (before the image is shown),
    // eliminating the cover→focal snap the old onLoad-driven version produced.
    const computeStyle = useCallback((nWin: number, nHin: number): React.CSSProperties => {
        let nW = nWin, nH = nHin;
        if (!nW || !nH) return { width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${focalX}% ${focalY}%` };

        if (focalRadius == null || focalRadius <= 0) {
            return { width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${focalX}% ${focalY}%` };
        }

        // The inner container is sized exactly to these props (no border/padding), so
        // they equal its clientWidth/Height — using them keeps computeStyle pure (no
        // ref read) so it's safe to call from useMemo during render.
        const contentW = containerWidth;
        const contentH = containerHeight;

        // Crop radius in natural image pixels
        const radiusPx = Math.max(1, (focalRadius / 100) * Math.min(nW, nH) / 2);
        const containerRadius = (circular
            ? Math.min(contentW, contentH)
            : Math.max(contentW, contentH)) / 2;

        // Scale: display pixels per natural pixel
        const desiredScale = containerRadius / radiusPx;

        // Ensure image covers the container with focal point centered.
        // Clamp focal fractions to avoid division by zero near edges.
        const fx = Math.max(0.01, Math.min(0.99, focalX / 100));
        const fy = Math.max(0.01, Math.min(0.99, focalY / 100));
        const minCoverScale = Math.max(
            contentW / (2 * fx * nW),
            contentW / (2 * (1 - fx) * nW),
            contentH / (2 * fy * nH),
            contentH / (2 * (1 - fy) * nH),
        );
        let scale = Math.max(desiredScale, minCoverScale);

        // Cap the rendered element size to 4× the container dimensions.
        // Without this, a 4000×3000 photo in a 96×64 tree card creates a huge GPU texture
        // that gets evicted when off-screen and re-uploaded on every pan-back, causing stutter.
        // Downscaling the element and compensating with a larger CSS scale gives identical
        // visual output while reducing GPU texture memory by ~100×.
        const maxRenderW = contentW * 4;
        const maxRenderH = contentH * 4;
        if (nW > maxRenderW || nH > maxRenderH) {
            const downFactor = Math.min(maxRenderW / nW, maxRenderH / nH);
            scale = scale / downFactor;
            nW = Math.round(nW * downFactor);
            nH = Math.round(nH * downFactor);
        }

        // Position: place the focal point at the container center
        const tx = contentW / 2 - fx * nW * scale;
        const ty = contentH / 2 - fy * nH * scale;

        return {
            position: 'absolute',
            left: 0,
            top: 0,
            width: nW,
            height: nH,
            transformOrigin: '0 0',
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            maxWidth: 'none',
        };
    }, [focalX, focalY, focalRadius, containerWidth, containerHeight, circular]);

    // Load-before-swap via a hidden loader layer. The painted image (`display`) only
    // advances to a new `effectiveSrc` after an off-screen <img> has loaded AND decoded
    // it; until then the previously-decoded portrait stays on screen. That makes a
    // person→person switch (or Back-nav) swap atomically — no blank/undecoded frame,
    // matching the hosted build. The loader carries the real `loading` attribute, so
    // off-screen consumers (tree cards) still defer their work natively.
    // The promoted image carries the focal `style` it was cropped with. That snapshot
    // is what a HELD frame keeps during a switch — otherwise the previous person's
    // photo would be re-cropped with the incoming person's focal point (a visible
    // "lag" where the old picture jumps to the wrong crop before the new one loads).
    const [display, setDisplay] = useState<{ src: string; nW: number; nH: number; style: React.CSSProperties } | null>(null);
    const [failedSrc, setFailedSrc] = useState<string | null>(null);

    // For the CURRENTLY-targeted image, derive the style live so editing its crop
    // (focal props change, same blob) re-styles it. While holding the PREVIOUS image
    // mid-swap (display.src ≠ effectiveSrc), keep its promotion-time snapshot so it
    // stays at its own crop until the new photo takes over.
    const displayStyle = useMemo(() => {
        if (!display) return undefined;
        return display.src === effectiveSrc ? computeStyle(display.nW, display.nH) : display.style;
    }, [display, effectiveSrc, computeStyle]);

    // "?" only when the CURRENT src genuinely failed — either the local blob read
    // (mediaError) or a loader load/decode failure. A still-loading src shows the
    // held previous frame (or nothing on a cold first load), never the glyph.
    const loadError = mediaError || (failedSrc != null && failedSrc === effectiveSrc);
    const needsLoad = !!effectiveSrc && effectiveSrc !== display?.src && effectiveSrc !== failedSrc;

    return (
        <div
            className={className}
            style={{
                width: containerWidth,
                height: containerHeight,
                borderRadius: circular ? '50%' : undefined,
                overflow: 'hidden',
                position: 'relative',
                flexShrink: 0,
            }}
        >
            {display && !loadError && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={display.src} alt={alt} decoding="async" style={displayStyle} />
            )}
            {needsLoad && !loadError && (
                /* Hidden loader — respects `loading` (lazy off-screen), decodes, then promotes. */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                    key={effectiveSrc}
                    src={effectiveSrc}
                    alt=""
                    aria-hidden="true"
                    loading={loading}
                    decoding="async"
                    onLoad={(e) => {
                        const el = e.currentTarget;
                        const nW = el.naturalWidth, nH = el.naturalHeight;
                        // Promote only once the blob actually decodes; a load that can't
                        // decode (corrupt) surfaces the "?" glyph instead of painting blank.
                        el.decode().then(
                            () => setDisplay({ src: effectiveSrc, nW, nH, style: computeStyle(nW, nH) }),
                            () => setFailedSrc(effectiveSrc),
                        );
                    }}
                    onError={() => setFailedSrc(effectiveSrc)}
                    style={HIDDEN_LOADER_STYLE}
                />
            )}
            {/* Only a genuine load failure shows the "?" glyph. A still-resolving
                blob (local/static path) holds the previous frame — no missing-image flash. */}
            {loadError && (
                <div className="absolute inset-0 flex items-center justify-center bg-hover-surface text-text-muted text-xs">
                    ?
                </div>
            )}
        </div>
    );
}
