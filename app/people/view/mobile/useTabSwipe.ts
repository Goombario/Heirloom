'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/** The phone's own back gesture starts in this strip, so a tab swipe never does. */
const EDGE_PX = 24;
/** A drag past this share of the width, or a flick, changes the tab. */
const COMMIT_SHARE = 0.28;
const FLICK_PX = 40;
const FLICK_SPEED = 0.5; // px per ms
const SLOP = 10;
const SETTLE_MS = 220;

/** Starting a drag here keeps the element's own behaviour: fields, the tab strip, maps. */
const OWN_GESTURE = 'input, textarea, select, [contenteditable="true"], [role="tablist"], [data-no-tab-swipe], .maplibregl-map';

/** True when the touch starts inside something that scrolls sideways (chips, strips). */
function inSideScroller(target: Element, root: Element): boolean {
    for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
        if (el.scrollWidth > el.clientWidth + 1) {
            const x = getComputedStyle(el).overflowX;
            if (x === 'auto' || x === 'scroll') return true;
        }
    }
    return false;
}

interface Options {
    /** Where a drag may start (the whole page). */
    rootRef: React.RefObject<HTMLElement | null>;
    /** What moves with the finger (the tab panel and its neighbour). */
    trackRef: React.RefObject<HTMLElement | null>;
    /** The neighbour in that direction, or null at either end. */
    neighbour: (dir: 1 | -1) => string | null;
    onCommit: (dir: 1 | -1) => void;
    /** Off while a sheet or viewer covers the page. */
    enabled: boolean;
}

/**
 * Drag the page sideways and the next tab slides in (#1053). Touch only: a mouse drag
 * stays a text selection. A drag that moves more down than across scrolls as usual, and
 * one that starts in the left edge strip, in a field, on the tab strip, in anything that
 * scrolls sideways or on a pinched-in page is left alone. Touch events rather than
 * `touch-action: pan-y`, which would also stop a pinched-in page panning sideways. Returns the neighbour being revealed,
 * for the caller to render beside the panel.
 */
export function useTabSwipe({ rootRef, trackRef, neighbour, onCommit, enabled }: Options): 1 | -1 | null {
    const [peek, setPeek] = useState<1 | -1 | null>(null);
    const latest = useRef({ neighbour, onCommit, enabled });
    useEffect(() => { latest.current = { neighbour, onCommit, enabled }; });

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        let start: { x: number; y: number; t: number; id: number } | null = null;
        let mode: 'maybe' | 'x' | null = null;
        let dir: 1 | -1 | 0 = 0;
        let dx = 0;
        let settleTimer = 0;

        const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        const place = (x: number, animate: boolean) => {
            const el = trackRef.current;
            if (!el) return;
            el.style.transition = animate && !reduced() ? `transform ${SETTLE_MS}ms cubic-bezier(.2,.8,.2,1)` : '';
            el.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
        };
        const reset = () => { mode = null; start = null; dir = 0; dx = 0; };
        const ours = (e: TouchEvent) => (start ? Array.from(e.changedTouches).find((x) => x.identifier === start!.id) : undefined);

        const onStart = (e: TouchEvent) => {
            if (mode === 'x') return;
            reset();
            if (e.touches.length !== 1 || !latest.current.enabled) return;
            // Pinched in, a sideways drag pans the zoomed page instead.
            if ((window.visualViewport?.scale ?? 1) > 1.01) return;
            const touch = e.touches[0];
            const target = e.target as Element | null;
            if (!target || !root.contains(target)) return;
            if (touch.clientX < EDGE_PX || target.closest(OWN_GESTURE) || inSideScroller(target, root)) return;
            start = { x: touch.clientX, y: touch.clientY, t: e.timeStamp, id: touch.identifier };
            mode = 'maybe';
        };

        const onMove = (e: TouchEvent) => {
            const touch = ours(e);
            if (!touch || !start) return;
            if (e.touches.length > 1) { if (mode === 'x') finish(e, false); else reset(); return; }
            dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (mode === 'maybe') {
                if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
                if (Math.abs(dy) >= Math.abs(dx) || !e.cancelable) { reset(); return; }
                mode = 'x';
            }
            // Ours now: the page doesn't scroll while the tabs move.
            e.preventDefault();
            const next: 1 | -1 = dx < 0 ? 1 : -1;
            if (next !== dir) {
                dir = next;
                setPeek(latest.current.neighbour(dir) ? dir : null);
            }
            // Past either end the page resists instead of following.
            place(latest.current.neighbour(dir) ? dx : dx / 4, false);
        };

        const finish = (e: TouchEvent, lifted: boolean) => {
            if (!start) return;
            const width = root.clientWidth;
            const speed = Math.abs(dx) / Math.max(1, e.timeStamp - start.t);
            const swipeDir: 1 | -1 = dir || (dx < 0 ? 1 : -1);
            const commit = lifted && latest.current.neighbour(swipeDir) != null
                && (Math.abs(dx) > width * COMMIT_SHARE || (Math.abs(dx) > FLICK_PX && speed > FLICK_SPEED));
            reset();
            place(commit ? -swipeDir * width : 0, true);
            window.clearTimeout(settleTimer);
            settleTimer = window.setTimeout(() => {
                // Swap the tab in the same frame the panel snaps back, so the old pane never flashes.
                flushSync(() => {
                    setPeek(null);
                    if (commit) latest.current.onCommit(swipeDir);
                });
                place(0, false);
            }, reduced() ? 0 : SETTLE_MS);
        };

        const onEnd = (e: TouchEvent) => {
            if (!ours(e)) return;
            if (mode === 'x') finish(e, e.type === 'touchend');
            else reset();
        };

        root.addEventListener('touchstart', onStart, { passive: true });
        root.addEventListener('touchmove', onMove, { passive: false });
        root.addEventListener('touchend', onEnd);
        root.addEventListener('touchcancel', onEnd);
        return () => {
            root.removeEventListener('touchstart', onStart);
            root.removeEventListener('touchmove', onMove);
            root.removeEventListener('touchend', onEnd);
            root.removeEventListener('touchcancel', onEnd);
            window.clearTimeout(settleTimer);
            place(0, false);
        };
    }, [rootRef, trackRef]);

    return peek;
}
