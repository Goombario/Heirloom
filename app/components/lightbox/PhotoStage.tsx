'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import useEmblaCarousel from 'embla-carousel-react';
import MediaImg from '@/app/components/MediaImg';
import { isPdfMedia } from '@/lib/media/allowed-extensions';
import DocumentStage from './DocumentStage';
import { usePrefersReducedMotion } from '@/app/hooks/usePrefersReducedMotion';
import { Button } from '@/app/components/ui/Button';
import { ChevronLeft, ChevronRight, X, Check, ScanFace } from '@/lib/icons';
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
    const [emblaRef, emblaApi] = useEmblaCarousel({ watchDrag: !tagMode, loop: false, duration: scrollDuration });

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

    // Toggle drag when entering/leaving tag mode.
    useEffect(() => {
        emblaApi?.reInit({ watchDrag: !tagMode, loop: false, duration: scrollDuration });
    }, [emblaApi, tagMode, scrollDuration]);

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
            if (cr && cr.width > 0 && cr.height > 0) setStageBox({ w: cr.width, h: cr.height });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

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

    return (
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
            {!bare && (
                // Tag mode swaps the whole bar rather than adding to it: the mode
                // disables drag, backdrop-close and face clicks, so it needs to look
                // like a different state, not the normal bar with an extra button
                // (#456). This mirrors MobileLightbox, which already does exactly
                // this — a titled bar plus a filled Done control.
                <div className="flex items-center gap-[14px] px-5 py-4 relative z-[5]">
                    {tagMode ? (
                        <>
                            <ScanFace className="w-5 h-5 text-white shrink-0" aria-hidden="true" />
                            <div className="text-base text-white font-medium min-w-0 truncate">{drawTargetTagId != null ? t('redraw_face') : t('tag_a_face')}</div>
                            <Button variant="primary" onClick={onDoneTagging}
                                icon={<Check className="w-[14px] h-[14px]" aria-hidden="true" />}
                                className="ml-auto min-h-11 shrink-0">
                                {t('done_tagging')}
                            </Button>
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
                        </>
                    )}
                </div>
            )}

            {/* stage — Embla viewport bounds the image (#2) */}
            <div
                className={bare ? 'flex-1 min-h-0 relative' : 'flex-1 min-h-0 relative px-10 pb-3'}
                onClick={(e) => { if (!tagMode && e.target === e.currentTarget) onClose(); }}
            >
                {canPrev && (
                    <button type="button" aria-label={tc('previous')} title={tc('previous')} onClick={() => emblaApi?.scrollPrev()}
                        className="absolute left-4 top-1/2 -translate-y-1/2 z-[3] w-11 h-11 rounded-full bg-white/10 border border-white/20 flex items-center justify-center cursor-pointer transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-on-dark">
                        <ChevronLeft className="w-6 h-6 text-white" aria-hidden="true" />
                    </button>
                )}
                {canNext && (
                    <button type="button" aria-label={tc('next')} title={tc('next')} onClick={() => emblaApi?.scrollNext()}
                        className="absolute right-4 top-1/2 -translate-y-1/2 z-[3] w-11 h-11 rounded-full bg-white/10 border border-white/20 flex items-center justify-center cursor-pointer transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-on-dark">
                        <ChevronRight className="w-6 h-6 text-white" aria-hidden="true" />
                    </button>
                )}

                <div className="overflow-hidden h-full" ref={(node) => { emblaRef(node); viewportRef.current = node; }}>
                    <div className="flex h-full" style={{ touchAction: tagMode ? 'none' : 'pan-y pinch-zoom' }}>
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
                                    onClick={(e) => { if (!tagMode && e.target === e.currentTarget) onClose(); }}
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
                                        style={{
                                            cursor: isActive && tagMode ? 'crosshair' : 'default',
                                            touchAction: isActive && tagMode ? 'none' : 'auto',
                                        }}
                                        onPointerDown={(e) => {
                                            if (!isActive || !tagMode || startRef.current) return;
                                            e.preventDefault();
                                            const r = e.currentTarget.getBoundingClientRect();
                                            startRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
                                            setRect(null);
                                            e.currentTarget.setPointerCapture(e.pointerId);
                                        }}
                                        onPointerMove={(e) => {
                                            const s = startRef.current; if (!isActive || !tagMode || !s) return;
                                            const r = e.currentTarget.getBoundingClientRect();
                                            const dx = e.clientX - r.left - s.x, dy = e.clientY - r.top - s.y;
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
