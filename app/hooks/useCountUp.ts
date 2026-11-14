'use client';

import { useLayoutEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';
const DURATION = 600;

/** Whether this stat has already counted up in this tab (session storage; false when it can't be read). */
function counted(key: string): boolean {
    try { return window.sessionStorage.getItem(key) === '1'; } catch { return true; }
}

function markCounted(key: string) {
    try { window.sessionStorage.setItem(key, '1'); } catch { /* private mode: count again next time */ }
}

/**
 * A number that counts up from zero to `value` (#20), once per tab session for
 * `key`: the first time the home page shows its stats, not on every return to
 * it. Reduced motion, a repeat visit, or `ready` false show `value` as it is.
 */
export function useCountUp(value: number, key: string, ready = true): number {
    const [shown, setShown] = useState<number | null>(null);
    // Before paint, so the final number never flashes ahead of the count.
    useLayoutEffect(() => {
        if (!ready || typeof window === 'undefined') return;
        if (value <= 0 || counted(key) || window.matchMedia(QUERY).matches) { setShown(null); return; }
        markCounted(key);
        setShown(0);
        const start = performance.now();
        let frame = requestAnimationFrame(function tick(now) {
            const p = Math.min(1, (now - start) / DURATION);
            const eased = 1 - Math.pow(1 - p, 3);
            setShown(p >= 1 ? null : Math.round(value * eased));
            if (p < 1) frame = requestAnimationFrame(tick);
        });
        return () => { cancelAnimationFrame(frame); setShown(null); };
    }, [value, key, ready]);
    return shown ?? value;
}
