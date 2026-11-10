'use client';

import { useEffect, useRef, useState } from 'react';

/** Below this, the bar never hides: the top of the page always shows it. */
const TOP_ZONE = 64;
/** Pixels of travel in one direction before the bar changes, so jitter doesn't flicker it. */
const STEP = 8;

/**
 * True while the page is scrolling down, false again on a flick up (mobile list kit,
 * #1057/#1058): the floating copper pill and a list's filter and chips slide away so
 * the list gets the screen, and come back the moment you scroll up. `pinned` keeps
 * them shown, e.g. while the filter field has focus; `off` skips listening at all.
 * The document is the scroller.
 */
export function useHideOnScroll({ pinned = false, off = false }: { pinned?: boolean; off?: boolean } = {}): boolean {
    const [hidden, setHidden] = useState(false);
    const last = useRef(0);
    const travel = useRef(0);

    useEffect(() => {
        if (off) return;
        last.current = window.scrollY;
        const onScroll = () => {
            const y = window.scrollY;
            const dy = y - last.current;
            last.current = y;
            if (y < TOP_ZONE) { travel.current = 0; setHidden(false); return; }
            // Restart the count when the direction flips.
            travel.current = Math.sign(dy) === Math.sign(travel.current) ? travel.current + dy : dy;
            if (travel.current > STEP) setHidden(true);
            else if (travel.current < -STEP) setHidden(false);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, [off]);

    return hidden && !pinned && !off;
}
