'use client';

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * True when the user has asked the OS to reduce motion. SSR/static-safe: returns
 * false during SSR and hydrates to the real value after mount.
 *
 * The blanket rule in `app/globals.css` neutralizes CSS animations and
 * transitions, so styling never needs this hook. It exists for motion driven in
 * JavaScript — Embla animates its track transform on requestAnimationFrame, which
 * no CSS rule can reach — where the caller has to opt out of the motion itself.
 */
export function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState<boolean>(
        typeof window === 'undefined' ? false : window.matchMedia(QUERY).matches,
    );
    useEffect(() => {
        const mq = window.matchMedia(QUERY);
        const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return reduced;
}
