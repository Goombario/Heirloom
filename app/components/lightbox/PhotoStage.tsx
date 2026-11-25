'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import useEmblaCarousel from 'embla-carousel-react';
import MediaImg from '@/app/components/MediaImg';
import { isPdfMedia } from '@/lib/media/allowed-extensions';
import DocumentStage from './DocumentStage';
import { usePrefersReducedMotion } from '@/app/hooks/usePrefersReducedMotion';
import { Button } from '@/app/components/ui/Button';
import { ChevronLeft, ChevronRight, X, Check, ScanFace, Plus, Minus } from '@/lib/icons';
import { isTypingTarget, readLetterShortcuts } from '@/lib/keyboard/shortcuts';
import {
    FIT, ZOOM_STEP, actualSizeScale, clampPan, isZoomed, maxScale, panBy, wheelFactor, zoomAt, zoomPercent,
    type Zoom, type ZoomBox,
} from '@/lib/media/zoom';
import { snapThumbSize } from '@/lib/media-url';
import type { Media } from '@/lib/db/schema';
import type { LightboxTag, DrawRect, FaceRegionInput } from './types';
import { tagPersonName, clampPercent } from './types';

const THUMB_W = snapThumbSize(128); // 128 — a valid server thumb size (#1)

// Horizontal breathing room each side of the image inside its 100%-width slide.
// The image is centered and capped at (viewport − 2·gutter), so adjacent slides
// never kiss during a swipe — there is always 2·gutter of dark between them.
const SLIDE_GUTTER = 14;

interface PhotoStageProps {
    items: Media[];
    index: number;
    onChangeIndex: (i: number) => void;
    treeId: number | null;
    alt: string;
    tags: LightboxTag[];
    overlayTags: boolean;
    tagMode: boolean;
    hoveredTagId: number | null;
    /**
     * Hover/focus channel shared with the rail. The photo now feeds it too, so
     * pointing at a face highlights its rail row and vice versa (#458).
     */
    onHoverTag: (id: number | null) => void;
    onDrawComplete: (region: FaceRegionInput) => void;
    /** Existing tag being redrawn; null/undefined means a new tag. */
    drawTargetTagId?: number | null;
    counterCurrent: number;
    counterTotal: number;
    ctxNoun: string;
    onClose: () => void;
    onDoneTagging: () => void;
    /**
     * When true, renders only the Embla pager + face-box overlay + draw handlers.
     * Hides the top bar, thumbnail strip, and tag-hint/Done block (mobile chrome
     * is supplied by MobileLightbox).
     */
    bare?: boolean;
    /** Unnamed faces from the photo's metadata, drawn dashed for people who can tag (#1121). */
    faces?: Array<FaceRegionInput & { Id: number }>;
    onFace?: (candidateId: number) => void;
    /** Holding a face box opens its tag sheet (phone editors); a tap still opens the person. */
    onHoldTag?: (tagId: number) => void;
}

const HOLD_MS = 500;
/** Two taps this close in time and space are a double-tap (phone zoom, #252). */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
/** A press that moves further than this is a pan, so its click must not follow a face link. */
const PAN_SLOP_PX = 4;
/** Arrow keys pan a zoomed photo by this much. */
const KEY_PAN_PX = 80;
const ZOOM_TOAST_MS = 1200;

export default function PhotoStage(props: PhotoStageProps) {
    const { items, index, onChangeIndex, treeId, alt, tags, overlayTags, tagMode,
        hoveredTagId, onHoverTag, onDrawComplete, drawTargetTagId,
        counterCurrent, counterTotal, ctxNoun, onClose, onDoneTagging, bare = false, faces = [], onFace, onHoldTag } = props;
    const t = useTranslations('mediaLightbox');
    const tc = useTranslations('common');
    const ft = useTranslations('faceTags');
    // A press that became a hold must not also follow the face's link on release.
    const hold = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
    const endHold = () => { if (hold.current.timer) clearTimeout(hold.current.timer); hold.current.timer = null; };
    useEffect(() => endHold, []);

    // Embla photo pager. Drag is disabled in tag mode so draw-to-tag and swipe
    // don't conflict (#12 / spec 5.1).
    //
    // `duration` is Embla's scroll-animation length (default 25). The default read
    // as a slow, motion-heavy glide on the prev/next buttons (#597), so it is cut
    // here. Reduced motion drops it to 0 — an instant cut, the same path
    // `scrollTo(i, true)` already takes below. This cannot be done in CSS: Embla
    // animates the track transform on requestAnimationFrame, so the blanket
    // reduced-motion rule in globals.css never touches it.
    const reducedMotion = usePrefersReducedMotion();
    const scrollDuration = reducedMotion ? 0 : 16;
    //
    // While a photo is zoomed (#252) a drag pans it instead, so Embla asks before
    // every drag. The callback reads refs, so its identity never changes and Embla
    // is not re-created on each zoom step.
    const tagModeRef = useRef(tagMode);
    const zoomRef = useRef<Zoom>(FIT);
    const allowDrag = useCallback(() => !tagModeRef.current && !isZoomed(zoomRef.current), []);
    const [emblaRef, emblaApi] = useEmblaCarousel({ watchDrag: allowDrag, loop: false, duration: scrollDuration });

    // Thumbnail strip — Embla again rather than a second scroll mechanism (#88).
    // The native `overflow-x-auto` strip this replaces hid its scrollbar in both
    // engines and had no drag handler and no buttons, so on desktop it could not
    // be scrolled by the user at all: it only ever moved as a side effect of
    // changing photo. dragFree + watchDrag restore click-drag and momentum.
    const [thumbRef, thumbApi] = useEmblaCarousel({
        containScroll: 'keepSnaps',
        align: 'center',
        dragFree: true,
        watchDrag: true,
        duration: scrollDuration,
    });
    // True while every thumb fits, which is the only time it is safe to centre
    // the track — see the justify-center note on the strip markup below.
    const [thumbsFit, setThumbsFit] = useState(false);
    const [canPrev, setCanPrev] = useState(false);
    const [canNext, setCanNext] = useState(false);

    // Draw state (active slide only).
    const imgRef = useRef<HTMLDivElement>(null);
    const startRef = useRef<{ x: number; y: number } | null>(null);
    const [rect, setRect] = useState<DrawRect | null>(null);

    // Leaving tag mode (Esc, Done), changing photo or swapping the media cancels a
    // half-drawn box: without this, the anchor of a press that Esc interrupted
    // survived, and the next draw continued from it (#639). The preview resets
    // during render (React's "adjust state on a prop change"); the anchor is a ref,
    // so it resets in an effect.
    const gestureScope = `${tagMode}:${index}:${items[index]?.Id ?? ''}`;
    const [rectScope, setRectScope] = useState(gestureScope);
    if (rectScope !== gestureScope) {
        setRectScope(gestureScope);
        setRect(null);
    }
    useEffect(() => { startRef.current = null; }, [gestureScope]);

    // Measured Embla-viewport box → px caps for the image so it never exceeds the
    // stage on either axis (#2). The stage padding (px-10 pb-3) is the buffer.
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const [stageBox, setStageBox] = useState<{ w: number; h: number } | null>(null);

    // Embla 'select' → controlled index. Guard the loop: only propagate when the
    // selected snap differs from the prop.
    const onSelect = useCallback(() => {
        if (!emblaApi) return;
        setCanPrev(emblaApi.canScrollPrev());
        setCanNext(emblaApi.canScrollNext());
        const sel = emblaApi.selectedScrollSnap();
        if (sel !== index) onChangeIndex(sel);
    }, [emblaApi, index, onChangeIndex]);

    useEffect(() => {
        if (!emblaApi) return;
        // Sync button state once after mount/reInit. rAF defers the setState call
        // out of the effect body so no-direct-set-state-in-use-effect is satisfied.
        const id = requestAnimationFrame(() => {
            setCanPrev(emblaApi.canScrollPrev());
            setCanNext(emblaApi.canScrollNext());
        });
        emblaApi.on('select', onSelect);
        emblaApi.on('reInit', onSelect);
        return () => {
            cancelAnimationFrame(id);
            emblaApi.off('select', onSelect);
            emblaApi.off('reInit', onSelect);
        };
    }, [emblaApi, onSelect]);

    // External index change (arrows, thumbs, keyboard, delete) → scroll Embla.
    useEffect(() => {
        if (emblaApi && emblaApi.selectedScrollSnap() !== index) emblaApi.scrollTo(index, true);
    }, [emblaApi, index]);

    // Zoom (#252). Scale 1 is Fit; see lib/media/zoom.ts for the transform's maths.
    const [zoom, setZoomState] = useState<Zoom>(FIT);
    const [animateZoom, setAnimateZoom] = useState(false);
    const zoomed = isZoomed(zoom);
    const activeIsPdf = items[index] ? isPdfMedia(items[index]) : false;
    // The fitted image size and its actual-size scale, measured once it has loaded.
    const [fitted, setFitted] = useState<{ imgW: number; imgH: number; oneToOne: number } | null>(null);
    const fittedRef = useRef(fitted);
    const stageBoxRef = useRef<{ w: number; h: number } | null>(null);
    useEffect(() => { tagModeRef.current = tagMode; }, [tagMode]);
    useEffect(() => { zoomRef.current = zoom; }, [zoom]);
    useEffect(() => { fittedRef.current = fitted; }, [fitted]);

    // A new photo always opens at Fit.
    const zoomScope = `${index}:${items[index]?.Id ?? ''}`;
    const [zoomScopeSeen, setZoomScopeSeen] = useState(zoomScope);
    if (zoomScopeSeen !== zoomScope) {
        setZoomScopeSeen(zoomScope);
        setZoomState(FIT);
        setFitted(null);
    }

    // Toggle drag when entering/leaving tag mode or zoom. reInit also ends a drag
    // Embla had already started (a pinch that began with one finger).
    useEffect(() => {
        emblaApi?.reInit({ watchDrag: allowDrag, loop: false, duration: scrollDuration });
    }, [emblaApi, tagMode, zoomed, allowDrag, scrollDuration]);

    // Keep the active thumbnail centred on index change. The reInit hook matters
    // because the strip is measured before its images have laid out; without a
    // recenter on re-measure the active thumb drifts off-centre (#thumbs).
    useEffect(() => {
        if (!thumbApi) return;
        thumbApi.scrollTo(index);
        const recenter = () => thumbApi.scrollTo(index);
        thumbApi.on('reInit', recenter);
        return () => { thumbApi.off('reInit', recenter); };
    }, [thumbApi, index]);

    // Track whether the strip overflows. Embla measures the track as laid out, so
    // this has to be read from Embla rather than guessed from items.length.
    useEffect(() => {
        if (!thumbApi) return;
        const measure = () => setThumbsFit(!thumbApi.canScrollPrev() && !thumbApi.canScrollNext());
        const id = requestAnimationFrame(measure);
        thumbApi.on('reInit', measure);
        return () => { cancelAnimationFrame(id); thumbApi.off('reInit', measure); };
    }, [thumbApi]);

    // Track the viewport's inner box so images can be px-capped on both axes.
    useEffect(() => {
        const el = viewportRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver((entries) => {
            const cr = entries[0]?.contentRect;
            // Never cap to 0 — a transient 0-height measurement (e.g. before layout
            // settles) must fall back to '100%', never hide the image.
            if (cr && cr.width > 0 && cr.height > 0) {
                stageBoxRef.current = { w: cr.width, h: cr.height };
                setStageBox({ w: cr.width, h: cr.height });
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Measure the fitted image whenever it loads or the stage resizes. `load` does
    // not bubble, but it does pass through ancestors in the capture phase.
    useEffect(() => {
        const el = imgRef.current;
        if (!el) return;
        const measure = () => {
            const img = el.querySelector('img');
            const imgW = el.offsetWidth, imgH = el.offsetHeight;
            if (!img || !img.complete || !(imgW > 0) || !(imgH > 0)) return;
            setFitted({ imgW, imgH, oneToOne: actualSizeScale(img.naturalWidth, imgW) });
        };
        const id = requestAnimationFrame(measure);
        el.addEventListener('load', measure, true);
        return () => { cancelAnimationFrame(id); el.removeEventListener('load', measure, true); };
    }, [zoomScope, stageBox]);

    // A resize can leave a zoomed photo panned past an edge; pull it back.
    const zoomBox = useCallback((): ZoomBox | null => {
        const f = fittedRef.current, b = stageBoxRef.current;
        return f && b ? { stageW: b.w, stageH: b.h, imgW: f.imgW, imgH: f.imgH } : null;
    }, []);
    useEffect(() => {
        const box = zoomBox();
        if (!box || !isZoomed(zoomRef.current)) return;
        const next = clampPan(zoomRef.current, box);
        if (next.x !== zoomRef.current.x || next.y !== zoomRef.current.y) {
            const id = requestAnimationFrame(() => setZoomState(next));
            return () => cancelAnimationFrame(id);
        }
    }, [stageBox, fitted, zoomBox]);

    // The phone has no zoom buttons, so a short label says how far in it is.
    const [toast, setToast] = useState<number | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

    /** Applies a zoom change. `animate` eases buttons, keys and double-clicks; gestures follow the hand. */
    const applyZoom = useCallback((update: (z: Zoom, box: ZoomBox, max: number, oneToOne: number) => Zoom, animate: boolean) => {
        const box = zoomBox();
        const f = fittedRef.current;
        if (!box || !f) return;
        const next = update(zoomRef.current, box, maxScale(f.oneToOne), f.oneToOne);
        zoomRef.current = next;
        setAnimateZoom(animate && !reducedMotion);
        setZoomState(next);
        if (bare) {
            if (toastTimer.current) clearTimeout(toastTimer.current);
            if (isZoomed(next)) {
                setToast(zoomPercent(next.scale, f.oneToOne));
                toastTimer.current = setTimeout(() => setToast(null), ZOOM_TOAST_MS);
            } else setToast(null);
        }
    }, [zoomBox, reducedMotion, bare]);

    /** A point on screen measured from the stage centre, which is also the fitted image's centre. */
    const fromCentre = useCallback((clientX: number, clientY: number) => {
        const r = viewportRef.current?.getBoundingClientRect();
        return r ? { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) } : { x: 0, y: 0 };
    }, []);

    const zoomStep = useCallback((dir: 1 | -1) => {
        applyZoom((z, box, max) => zoomAt(z, dir > 0 ? z.scale * ZOOM_STEP : z.scale / ZOOM_STEP, { x: 0, y: 0 }, box, max), true);
    }, [applyZoom]);
    const zoomFit = useCallback(() => applyZoom(() => FIT, true), [applyZoom]);
    /** Fit ↔ actual size, around a point (double-click, double-tap) or the centre (the % button). */
    const zoomToggle = useCallback((focus: { x: number; y: number }) => {
        applyZoom((z, box, max, oneToOne) => (isZoomed(z) ? FIT : zoomAt(FIT, oneToOne > 1.01 ? oneToOne : 2, focus, box, max)), true);
    }, [applyZoom]);

    // Wheel and trackpad pinch zoom around the pointer. A native listener, because
    // React's wheel handler is passive and can't stop the page from scrolling.
    useEffect(() => {
        const el = viewportRef.current;
        if (!el || activeIsPdf) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const focus = fromCentre(e.clientX, e.clientY);
            const factor = wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey);
            applyZoom((z, box, max) => zoomAt(z, z.scale * factor, focus, box, max), false);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [activeIsPdf, applyZoom, fromCentre]);

    // Keys (desktop): + and − zoom, 0 fits. Character keys, so they follow the
    // Options › Keyboard switch (#32). While zoomed the arrow keys pan rather than
    // change photo, so they are taken in the capture phase before the lightbox sees them.
    const [spaceHeld, setSpaceHeld] = useState(false);
    const spaceRef = useRef(false);
    useEffect(() => {
        if (bare || activeIsPdf) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
            if (isZoomed(zoomRef.current) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                e.stopPropagation();
                const dx = e.key === 'ArrowLeft' ? KEY_PAN_PX : e.key === 'ArrowRight' ? -KEY_PAN_PX : 0;
                const dy = e.key === 'ArrowUp' ? KEY_PAN_PX : e.key === 'ArrowDown' ? -KEY_PAN_PX : 0;
                applyZoom((z, box) => panBy(z, dx, dy, box), true);
                return;
            }
            // Space and drag moves a zoomed photo while tagging, where a plain drag draws.
            if (e.code === 'Space' && tagModeRef.current) {
                e.preventDefault();
                spaceRef.current = true;
                setSpaceHeld(true);
                return;
            }
            if (!readLetterShortcuts()) return;
            if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomStep(1); }
            else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomStep(-1); }
            else if (e.key === '0') { e.preventDefault(); zoomFit(); }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') { spaceRef.current = false; setSpaceHeld(false); }
        };
        const onBlur = () => { spaceRef.current = false; setSpaceHeld(false); };
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', onBlur);
        return () => {
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', onBlur);
        };
    }, [bare, activeIsPdf, applyZoom, zoomStep, zoomFit]);

    // Pan (one pointer while zoomed) and pinch (two touches) on the active slide.
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const panRef = useRef<{ x: number; y: number; moved: number } | null>(null);
    const pinchRef = useRef<{ d0: number; s0: number } | null>(null);
    const suppressClick = useRef(false);
    const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
    const [panning, setPanning] = useState(false);

    function onSlidePointerDown(e: React.PointerEvent<HTMLDivElement>) {
        if (activeIsPdf) return;
        if (e.pointerType === 'touch') {
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.current.size === 2 && !tagMode) {
                const [a, b] = [...pointers.current.values()];
                pinchRef.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: zoomRef.current.scale };
                panRef.current = null;
                return;
            }
        }
        if (!isZoomed(zoomRef.current) || e.button > 0) return;
        if (tagMode && !spaceRef.current) return;
        if (startRef.current) return; // a face box is being drawn
        panRef.current = { x: e.clientX, y: e.clientY, moved: 0 };
        suppressClick.current = false;
        setPanning(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
    }

    function onSlidePointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (e.pointerType === 'touch' && pointers.current.has(e.pointerId)) {
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const pinch = pinchRef.current;
            if (pinch && pointers.current.size >= 2) {
                const [a, b] = [...pointers.current.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                const focus = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
                applyZoom((z, box, max) => zoomAt(z, pinch.s0 * (d / pinch.d0), focus, box, max), false);
                suppressClick.current = true;
                return;
            }
        }
        const pan = panRef.current;
        if (!pan) return;
        const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
        pan.x = e.clientX; pan.y = e.clientY;
        pan.moved += Math.abs(dx) + Math.abs(dy);
        if (pan.moved > PAN_SLOP_PX) suppressClick.current = true;
        applyZoom((z, box) => panBy(z, dx, dy, box), false);
    }

    function onSlidePointerUp(e: React.PointerEvent<HTMLDivElement>) {
        const wasPinch = pinchRef.current != null;
        if (e.pointerType === 'touch') {
            pointers.current.delete(e.pointerId);
            if (pointers.current.size < 2) pinchRef.current = null;
        }
        const pan = panRef.current;
        panRef.current = null;
        setPanning(false);
        // Double-tap toggles Fit and actual size on the phone. Mice use dblclick.
        if (e.pointerType === 'touch' && !wasPinch && !tagMode && !activeIsPdf && (!pan || pan.moved <= PAN_SLOP_PX) && e.type === 'pointerup') {
            const now = e.timeStamp, prev = lastTap.current;
            if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX) {
                lastTap.current = null;
                suppressClick.current = true;
                zoomToggle(fromCentre(e.clientX, e.clientY));
            } else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
        }
    }

    function finishDraw() {
        const img = imgRef.current;
        if (!img || !rect || rect.w < 8 || rect.h < 8) { setRect(null); startRef.current = null; return; }
        onDrawComplete({
            RegionX: clampPercent((rect.x / img.offsetWidth) * 100),
            RegionY: clampPercent((rect.y / img.offsetHeight) * 100),
            RegionW: clampPercent((rect.w / img.offsetWidth) * 100),
            RegionH: clampPercent((rect.h / img.offsetHeight) * 100),
        });
        setRect(null); startRef.current = null;
    }

    // The phone (bare) stage is edge to edge, so a photo can fill the screen's width
    // (the owner's phone review of #1117); the desktop keeps its gutters and arrows' room.
    const gutter = bare ? 0 : SLIDE_GUTTER;
    const imgCapStyle = {
        maxWidth: stageBox ? stageBox.w - gutter * 2 : '100%',
        maxHeight: stageBox ? stageBox.h : '100%',
        width: 'auto',
        height: 'auto',
        objectFit: 'contain' as const,
        borderRadius: bare ? 0 : 8,
        // Transparent, NOT --card. That token is a page-surface colour (white in
        // light mode, #292524 in dark), so an image that had not painted yet
        // flashed a white rectangle over the near-black stage — but only in light
        // mode, because the dark value happens to match the stage. The stage
        // gradient behind it is a dark constant in both themes, so showing it
        // through is correct everywhere.
        background: 'transparent',
        display: 'block' as const,
    };

    // − / % / + / Fit at the right end of the top bar (#252 B). Same place browsing
    // and tagging; while tagging, Done tagging sits just left of them.
    const pct = fitted ? zoomPercent(zoom.scale, fitted.oneToOne) : null;
    const zoomBtn = 'h-9 min-w-9 px-2 flex items-center justify-center text-white text-sm cursor-pointer transition-colors hover:bg-white/15 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-on-dark';
    const zoomControls = !bare && !activeIsPdf ? (
        <div role="group" aria-label={t('zoom_group')} className="flex items-center shrink-0 rounded-full bg-white/10 border border-white/20 overflow-hidden">
            <button type="button" className={zoomBtn} onClick={() => zoomStep(-1)} disabled={!zoomed}
                aria-label={t('zoom_out')} title={t('zoom_out')}>
                <Minus className="w-4 h-4" aria-hidden="true" />
            </button>
            <button type="button" className={`${zoomBtn} tabular-nums min-w-[52px]`} onClick={() => zoomToggle({ x: 0, y: 0 })} disabled={!fitted}
                title={t('zoom_toggle')}>
                {pct != null ? t('zoom_percent', { percent: pct }) : '–'}
            </button>
            <button type="button" className={zoomBtn} onClick={() => zoomStep(1)} disabled={!fitted || (fitted != null && zoom.scale >= maxScale(fitted.oneToOne) - 0.001)}
                aria-label={t('zoom_in')} title={t('zoom_in')}>
                <Plus className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="w-px h-5 bg-white/20" aria-hidden="true" />
            <button type="button" className={zoomBtn} onClick={zoomFit} disabled={!zoomed}>
                {t('zoom_fit')}
            </button>
        </div>
    ) : null;

    return (
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
            {!bare && (
                // Tag mode swaps the whole bar rather than adding to it: the mode
                // disables drag, backdrop-close and face clicks, so it needs to look
                // like a different state, not the normal bar with an extra button
                // (#456). This mirrors MobileLightbox, which already does exactly
                // this — a titled bar plus a filled Done control.
                // Its empty part is backdrop too (#253): a click there closes, the
                // same guard as the stage below. Tag mode keeps backdrop close off.
                <div data-testid="lightbox-top-bar" className="flex items-center gap-[14px] px-5 py-4 relative z-[5]"
                    onClick={(e) => { if (!tagMode && !zoomed && e.target === e.currentTarget) onClose(); }}>
                    {tagMode ? (
                        <>
                            <ScanFace className="w-5 h-5 text-white shrink-0" aria-hidden="true" />
                            <div className="text-base text-white font-medium min-w-0 truncate">{drawTargetTagId != null ? t('redraw_face') : t('tag_a_face')}</div>
                            <Button variant="primary" onClick={onDoneTagging}
                                icon={<Check className="w-[14px] h-[14px]" aria-hidden="true" />}
                                className="ml-auto min-h-11 shrink-0">
                                {t('done_tagging')}
                            </Button>
                            {zoomControls}
                        </>
                    ) : (
                        <>
                            <button type="button" onClick={onClose} aria-label={tc('close')} title={tc('close')}
                                className="w-11 h-11 rounded-full bg-white/10 border border-white/20 flex items-center justify-center shrink-0 cursor-pointer transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-on-dark">
                                <X className="w-[19px] h-[19px] text-white" aria-hidden="true" />
                            </button>
                            <div className="min-w-0">
                                <div className="text-sm text-white/85 truncate">{ctxNoun}</div>
                                <div className="tabular-nums text-xs text-white/40">{t('photo_counter', { current: counterCurrent, total: counterTotal })}</div>
                            </div>
                            {zoomControls && <div className="ml-auto">{zoomControls}</div>}
                        </>
                    )}
                </div>
            )}

            {/* stage — Embla viewport bounds the image (#2) */}
            <div
                className={bare ? 'flex-1 min-h-0 relative' : 'flex-1 min-h-0 relative px-10 pb-3'}
                onClick={(e) => { if (!tagMode && !zoomed && e.target === e.currentTarget) onClose(); }}
            >
                {bare && toast != null && (
                    <div role="status" className="absolute top-3 left-1/2 -translate-x-1/2 z-[4] pointer-events-none rounded-full bg-black/70 px-3 py-1 text-sm text-white tabular-nums">
                        {t('zoom_toast', { percent: toast })}
                    </div>
                )}
                {canPrev && (
                    <button type="button" aria-label={tc('previous')} title={tc('previous')} onClick={() => emblaApi?.scrollPrev()}
                        disabled={zoomed}
                        className="absolute left-4 top-1/2 -translate-y-1/2 z-[3] w-11 h-11 rounded-full bg-white/10 border border-white/20 flex items-center justify-center cursor-pointer transition-colors hover:bg-white/20 disabled:opacity-30 disabled:cursor-default disabled:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-on-dark">
                        <ChevronLeft className="w-6 h-6 text-white" aria-hidden="true" />
                    </button>
                )}
                {canNext && (
                    <button type="button" aria-label={tc('next')} title={tc('next')} onClick={() => emblaApi?.scrollNext()}
                        disabled={zoomed}
                        className="absolute right-4 top-1/2 -translate-y-1/2 z-[3] w-11 h-11 rounded-full bg-white/10 border border-white/20 flex items-center justify-center cursor-pointer transition-colors hover:bg-white/20 disabled:opacity-30 disabled:cursor-default disabled:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-on-dark">
                        <ChevronRight className="w-6 h-6 text-white" aria-hidden="true" />
                    </button>
                )}

                <div className="overflow-hidden h-full" ref={(node) => { emblaRef(node); viewportRef.current = node; }}>
                    {/* No browser pinch-zoom: the stage zooms the photo itself (#252). */}
                    <div className="flex h-full" style={{ touchAction: tagMode || zoomed ? 'none' : 'pan-y' }}>
                        {items.map((it, i) => {
                            const isActive = i === index;
                            const shouldLoad = Math.abs(i - index) <= 1;
                            return (
                                <div
                                    key={it.Id}
                                    className="flex-[0_0_100%] min-w-0 h-full flex items-center justify-center"
                                    // Click the dark area around the photo to dismiss (issue #161);
                                    // never while drawing a face tag, and only when the empty flex
                                    // area itself is clicked (not the image or its overlays).
                                    // While zoomed the dark area is part of the photo you can drag.
                                    onClick={(e) => { if (!tagMode && !zoomed && e.target === e.currentTarget) onClose(); }}
                                    {...(isActive ? {
                                        onPointerDown: onSlidePointerDown,
                                        onPointerMove: onSlidePointerMove,
                                        onPointerUp: onSlidePointerUp,
                                        onPointerCancel: onSlidePointerUp,
                                        // A pan or pinch that ends over a face must not follow its link.
                                        onClickCapture: (e: React.MouseEvent) => {
                                            if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; }
                                        },
                                        onDoubleClick: (e: React.MouseEvent) => {
                                            if (tagMode || activeIsPdf) return;
                                            zoomToggle(fromCentre(e.clientX, e.clientY));
                                        },
                                    } : {})}
                                >
                                    {/* One wrapper shape for every slide, active or not. The
                                        active slide used to render a <div> wrapper while the
                                        others rendered a bare <MediaImg>; changing the child's
                                        element type made React unmount and recreate the <img>
                                        on every index change, so both the outgoing and incoming
                                        photo repainted from empty — the flash. Only the ref,
                                        handlers and overlays vary now; the <img> persists. */}
                                    <div
                                        ref={isActive ? imgRef : undefined}
                                        className="relative inline-block leading-[0] select-none"
                                        data-testid={isActive ? 'photo-zoom-target' : undefined}
                                        style={{
                                            cursor: !isActive ? 'default'
                                                : tagMode ? (spaceHeld && zoomed ? (panning ? 'grabbing' : 'grab') : 'crosshair')
                                                : zoomed ? (panning ? 'grabbing' : 'grab') : 'default',
                                            touchAction: isActive && (tagMode || zoomed) ? 'none' : 'auto',
                                            ...(isActive && zoomed ? {
                                                transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
                                                transformOrigin: 'center center',
                                                willChange: 'transform',
                                            } : {}),
                                            transition: isActive && animateZoom ? 'transform 140ms ease-out' : undefined,
                                        }}
                                        onPointerDown={(e) => {
                                            // Space held: the slide pans instead (#252).
                                            if (!isActive || !tagMode || startRef.current || spaceRef.current) return;
                                            e.preventDefault();
                                            // The wrapper is scaled while zoomed; the box is kept in
                                            // its own (fitted) pixels, which is what finishDraw expects.
                                            const r = e.currentTarget.getBoundingClientRect();
                                            const k = zoomRef.current.scale;
                                            startRef.current = { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
                                            setRect(null);
                                            e.currentTarget.setPointerCapture(e.pointerId);
                                        }}
                                        onPointerMove={(e) => {
                                            const s = startRef.current; if (!isActive || !tagMode || !s) return;
                                            const r = e.currentTarget.getBoundingClientRect();
                                            const k = zoomRef.current.scale;
                                            const dx = (e.clientX - r.left) / k - s.x, dy = (e.clientY - r.top) / k - s.y;
                                            setRect({ x: Math.min(s.x, s.x + dx), y: Math.min(s.y, s.y + dy), w: Math.abs(dx), h: Math.abs(dy) });
                                        }}
                                        // Outside tag mode a release only drops the gesture, so a
                                        // press Esc cancelled can never create or move a tag.
                                        onPointerUp={() => { if (isActive && tagMode) finishDraw(); else startRef.current = null; }}
                                        onLostPointerCapture={() => { if (isActive && tagMode) finishDraw(); else startRef.current = null; }}
                                    >
                                        {shouldLoad && isPdfMedia(it) ? (
                                            <DocumentStage mediaId={it.Id} treeId={treeId} title={isActive ? alt : ''}
                                                active={isActive} phone={bare} box={stageBox} gutter={gutter} />
                                        ) : shouldLoad ? (
                                            <MediaImg
                                                mediaId={it.Id}
                                                treeId={treeId}
                                                alt={isActive ? alt : ''}
                                                // Pre-warm only the immediate neighbours. Mounting a
                                                // full MediaImg for every slide still starts a local
                                                // full-blob read even when the browser defers decoding
                                                // the off-screen <img>.
                                                loading="eager"
                                                stage
                                                style={imgCapStyle}
                                            />
                                        ) : null}

                                        {/* Persistent mode frame. The exit affordance alone was
                                            missable (#456); this makes the MODE visible, not just
                                            its exit. It sits on the photo wrapper, the same box the
                                            draw handlers measure, so letterboxed stage space never
                                            reads as drawable (#640). Inert so it never intercepts
                                            the draw gesture. */}
                                        {isActive && !bare && tagMode && (
                                            <div data-testid="tag-mode-frame" className="pointer-events-none absolute inset-0 rounded-lg border-2 border-ink-on-dark/55" aria-hidden="true" />
                                        )}

                                        {isActive && tagMode && rect && (
                                            <div className="pointer-events-none absolute rounded"
                                                style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, border: '2px solid var(--color-ink-on-dark)', background: 'color-mix(in srgb, var(--color-ink-on-dark) 14%, transparent)' }} />
                                        )}

                                        {isActive && tags.map((tag) => {
                                            // Every tag renders a wrapper unconditionally, even when
                                            // overlays are off — visibility is opacity, not mounting.
                                            // Early-returning left nothing under the cursor to hover,
                                            // which is why hover-reveal needed a hit-testing layer
                                            // rather than a style tweak (#458).
                                            const revealed = overlayTags || tag.Id === hoveredTagId;
                                            const name = tagPersonName(tag, t('photo_alt'));
                                            const highlighted = !tagMode && tag.Id === hoveredTagId;
                                            const above = tag.RegionY + tag.RegionH / 2 > 50;
                                            return (
                                                <div key={tag.Id} className="absolute transition-opacity duration-150"
                                                    style={{
                                                        left: `${tag.RegionX}%`, top: `${tag.RegionY}%`,
                                                        width: `${tag.RegionW}%`, height: `${tag.RegionH}%`,
                                                        opacity: revealed ? 1 : 0,
                                                        // Stays 'none' in tag mode so a hidden hit target can
                                                        // never swallow the draw gesture.
                                                        pointerEvents: tagMode ? 'none' : 'auto',
                                                    }}
                                                    onMouseEnter={() => { if (!tagMode) onHoverTag(tag.Id); }}
                                                    onMouseLeave={() => { if (!tagMode) onHoverTag(null); }}>
                                                    {/* A link, not a popover: the face goes straight to the
                                                        person (#457). Focus reveals the box too, so keyboard
                                                        users are not tabbing through invisible targets. */}
                                                    <a href={`/people/view?id=${tag.PersonId}`} aria-label={name}
                                                        tabIndex={tagMode ? -1 : undefined}
                                                        onFocus={() => { if (!tagMode) onHoverTag(tag.Id); }}
                                                        onBlur={() => { if (!tagMode) onHoverTag(null); }}
                                                        {...(onHoldTag && !tagMode ? {
                                                            onPointerDown: () => {
                                                                endHold();
                                                                hold.current.fired = false;
                                                                hold.current.timer = setTimeout(() => { hold.current.fired = true; onHoldTag(tag.Id); }, HOLD_MS);
                                                            },
                                                            onPointerUp: endHold,
                                                            onPointerLeave: endHold,
                                                            onPointerCancel: endHold,
                                                            onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
                                                            onClick: (e: React.MouseEvent) => { if (hold.current.fired) { e.preventDefault(); hold.current.fired = false; } },
                                                        } : {})}
                                                        className="absolute inset-0 block p-0 rounded shadow-[0_0_0_1px_rgba(0,0,0,0.45)] focus-visible:outline-none"
                                                        style={{ cursor: tagMode ? 'default' : 'pointer', border: `2px solid ${highlighted ? 'var(--color-ink-on-dark)' : 'rgba(255,255,255,0.85)'}`, background: 'transparent' }} />
                                                    <span className="pointer-events-none absolute left-1/2 whitespace-nowrap max-w-[160px] overflow-hidden text-ellipsis text-white text-xs leading-[1.4] px-[7px] py-[2px] rounded-[10px] bg-black/80"
                                                        style={above ? { bottom: '100%', transform: 'translate(-50%,-4px)' } : { top: '100%', transform: 'translate(-50%,4px)' }}>
                                                        {name}
                                                    </span>
                                                </div>
                                            );
                                        })}

                                        {isActive && !tagMode && onFace && faces.map((face) => {
                                            const above = face.RegionY + face.RegionH / 2 > 50;
                                            return (
                                                <div key={`f${face.Id}`} className="absolute"
                                                    style={{ left: `${face.RegionX}%`, top: `${face.RegionY}%`, width: `${face.RegionW}%`, height: `${face.RegionH}%` }}>
                                                    <button type="button" aria-label={ft('who_is_this')} onClick={() => onFace(face.Id)}
                                                        className="absolute inset-0 block p-0 rounded border-2 border-dashed border-white/85 bg-white/5 shadow-[0_0_0_1px_rgba(0,0,0,0.35)] focus-visible:outline-none focus-visible:border-ink-on-dark" />
                                                    {overlayTags && (
                                                        <span className="pointer-events-none absolute left-1/2 whitespace-nowrap text-white text-xs leading-[1.4] px-[7px] py-[2px] rounded-[10px] bg-black/80 border border-dashed border-white/50"
                                                            style={above ? { bottom: '100%', transform: 'translate(-50%,-4px)' } : { top: '100%', transform: 'translate(-50%,4px)' }}>
                                                            {ft('who_is_this')}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {!bare && tagMode && (
                // Prompt only — the Done control moved into the header above, so the
                // exit sits in the same place on desktop as it does on mobile.
                // role="status" announces the mode change, which nothing did before.
                <div role="status" className="text-center text-white text-sm pb-3 px-6 leading-snug">
                    {drawTargetTagId != null && <span className="font-medium">{t('redraw_face')}: </span>}
                    {drawTargetTagId != null ? t('redraw_box_prompt') : t('draw_box_prompt')} <span className="text-white/55">{t('tag_mode_esc_hint')}</span>
                    {!activeIsPdf && <> <span className="text-white/55">{t('tag_mode_zoom_hint')}</span></>}
                </div>
            )}

            {!bare && !tagMode && !activeIsPdf && (
                // The row is always there for photos so the stage doesn't jump when zoom starts.
                <div className="text-center text-white/55 text-sm pb-3 px-6 leading-snug" aria-hidden={!zoomed}>
                    {zoomed
                        ? t('zoom_hint')
                        : '\u00a0'}
                </div>
            )}

            {!bare && items.length > 1 && (
                // Opaque thumbnail strip (only the area behind the photo is transparent).
                <div className="overflow-hidden px-[18px] pb-[18px] pt-[10px] bg-[color:var(--color-lightbox-stage-bottom)]" ref={thumbRef}>
                    {/* justify-center ONLY while everything fits. Centring an
                        OVERFLOWING flex track is what broke the previous Embla
                        attempt (a2cc23e used `justify-center min-w-min`): the
                        overflow splits to both sides, the leading slides land at a
                        negative offset, and Embla inherits that geometry and
                        computes a scroll range that collapses — which is why it
                        "never scrolled" and got replaced. Gating on the measured
                        fit keeps the centred look for short strips without ever
                        handing Embla a broken track. */}
                    <div className={`flex gap-[7px] ${thumbsFit ? 'justify-center' : ''}`}>
                        {items.map((it, i) => {
                            // Its title when it has one; else "Photo 3" or "Document 3" (#1232).
                            const label = it.Title?.trim() || t(isPdfMedia(it) ? 'thumbnail_document_n' : 'thumbnail_n', { n: i + 1 });
                            return (
                            <button key={it.Id} type="button" onClick={() => onChangeIndex(i)}
                                aria-label={label} title={label} aria-current={i === index ? 'true' : undefined}
                                className="flex-[0_0_auto] w-[50px] h-[38px] rounded-[5px] overflow-hidden cursor-pointer transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-on-dark"
                                style={i === index ? { outline: '2px solid var(--color-on-media)', outlineOffset: 2 } : { opacity: 0.55 }}>
                                <MediaImg mediaId={it.Id} contentType={it.ContentType} treeId={treeId} alt="" width={THUMB_W}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
