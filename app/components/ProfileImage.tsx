'use client';
import { useState, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import type { CSSProperties } from 'react';
import { focalThumbWidth, withThumbWidth } from '@/lib/media-url';
import { useMediaUrl } from '@/lib/media/useMediaUrl';
import { PORTRAIT_FRAMING, framePhoto } from '@/lib/media/framing';
import { useIsMobile } from '@/app/hooks/useIsMobile';

// One ResizeObserver for every portrait on the page (a tree can hold hundreds).
type BoxListener = (w: number, h: number) => void;
const boxListeners = new Map<Element, BoxListener>();
let boxObserver: ResizeObserver | null = null;
function observeBox(el: Element, listener: BoxListener): () => void {
    if (typeof ResizeObserver === 'undefined') return () => {};
    boxObserver ??= new ResizeObserver((entries) => {
        for (const e of entries) {
            const el = e.target as HTMLElement;
            boxListeners.get(el)?.(el.clientWidth, el.clientHeight);
        }
    });
    boxListeners.set(el, listener);
    boxObserver.observe(el);
    return () => { boxListeners.delete(el); boxObserver?.unobserve(el); };
}

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
    /** The face tag's width and height in percent of the photo, when known: frames the
     *  tag's true shape instead of a square of `focalRadius`. */
    regionW?: number | null;
    regionH?: number | null;
    /** The frame's design size: sizes the box (unless `fillParent`) and picks the thumbnail.
     *  The crop itself is computed from the box as measured on screen. */
    containerWidth: number;
    containerHeight: number;
    /** Fill the parent (100% × 100%) instead of a fixed `containerWidth` × `containerHeight`
     *  box, for frames the stylesheet resizes (the desktop covers narrow below 1024px). */
    fillParent?: boolean;
    circular?: boolean;
    className?: string;
    /** Override the auto-derived thumbnail width (in CSS pixels). */
    thumbSize?: number;
    /** Defaults to 'lazy'. Pass 'eager' for above-the-fold heroes. */
    loading?: 'lazy' | 'eager';
}

/**
 * Profile image framed on the person's face.
 *
 * FocalX/FocalY: 0-100, center of the face as % of image dimensions.
 * FocalRadius: percentage (0-100+) of the image's min-dimension half-radius.
 *   - null / undefined = no crop set; falls back to object-cover + objectPosition
 *   - 100 = the face box's side equals min(nW, nH)
 *
 * The framing rule (how much of the frame the face fills, how high it sits) lives in
 * `lib/media/framing.ts` (`PORTRAIT_FRAMING`), with one set of numbers for phone pages
 * and one for desktop. The crop is computed for the box as measured on screen, so a
 * frame the stylesheet resizes, or a ring drawn on the box, stays centred.
 *
 * Rendering strategy: image at natural dimensions + CSS transform: translate() scale().
 * GPU-composited, avoids object-position clamping.
 */
export default function ProfileImage({
    mediaId,
    treeId,
    alt,
    focalX = 50,
    focalY = 50,
    focalRadius,
    regionW,
    regionH,
    containerWidth,
    containerHeight,
    fillParent = false,
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
    // The box as laid out (inside any border), so the crop follows the real frame.
    // Until it is measured (and where layout reports 0, as in tests) the design size stands in.
    const boxRef = useRef<HTMLDivElement>(null);
    const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
    useLayoutEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const set = (w: number, h: number) => setMeasured((m) => (w > 0 && h > 0 && (m?.w !== w || m?.h !== h) ? { w, h } : m));
        set(el.clientWidth, el.clientHeight);
        return observeBox(el, set);
    }, []);
    const boxW = measured?.w ?? containerWidth;
    const boxH = measured?.h ?? containerHeight;
    const shares = useIsMobile() ? PORTRAIT_FRAMING.phone : PORTRAIT_FRAMING.desktop;

    // Pure focal → CSS style, computed from the image's natural dimensions. Kept
    // side-effect-free so it can run at decode time (before the image is shown),
    // eliminating the cover→focal snap the old onLoad-driven version produced.
    const computeStyle = useCallback((nWin: number, nHin: number): React.CSSProperties => {
        let nW = nWin, nH = nHin;
        if (!nW || !nH) return { width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${focalX}% ${focalY}%` };

        if (focalRadius == null || focalRadius <= 0) {
            return { width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${focalX}% ${focalY}%` };
        }

        const contentW = boxW;
        const contentH = boxH;
        const at = framePhoto({
            photo: { w: nW, h: nH }, frame: { w: contentW, h: contentH },
            focalX, focalY, focalRadius, regionW, regionH, circular, shares,
        });
        let scale = at.scale;

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

        // The offset is in frame px, so the downscale above leaves it unchanged.
        const tx = at.left;
        const ty = at.top;

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
    }, [focalX, focalY, focalRadius, regionW, regionH, boxW, boxH, circular, shares]);

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
            ref={boxRef}
            className={className}
            style={{
                width: fillParent ? '100%' : containerWidth,
                height: fillParent ? '100%' : containerHeight,
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
