'use client';

import { useSyncExternalStore } from 'react';

const QUERIES = { md: '(max-width: 767px)', lg: '(max-width: 1023px)' } as const;

const subscribers = {
    md: (onChange: () => void) => listen(QUERIES.md, onChange),
    lg: (onChange: () => void) => listen(QUERIES.lg, onChange),
};
function listen(query: string, onChange: () => void) {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
}

/**
 * True when the viewport is mobile-width (<768px). SSR/static-safe: it's false
 * during the prerender AND during hydration, then re-renders with the real
 * value. A client render that isn't hydrating (a client-side navigation) reads
 * the real value straight away. Reading `matchMedia` on the first client render
 * made a phone hydrate different markup from the prerender: React error #418
 * on `/people/new` at 390 (#845).
 *
 * Used to branch portaled UI (Vaul drawers) that cannot rely on `md:hidden`
 * because portals escape into document.body, and the person form's two layouts.
 * `below="lg"` asks the same below the lg breakpoint (<1024px), for a sheet that
 * stands in for a desktop rail on tablets too (the tree's Display sheet, #936).
 */
export function useIsMobile(below: 'md' | 'lg' = 'md'): boolean {
    return useSyncExternalStore(subscribers[below], () => window.matchMedia(QUERIES[below]).matches, () => false);
}
