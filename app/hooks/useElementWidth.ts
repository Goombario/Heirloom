'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * An element's width, kept current. A callback ref, so it also measures an element
 * that mounts late (inside a sheet, or after the data arrives). 0 until measured.
 */
export function useElementWidth<T extends HTMLElement>() {
    const [width, setWidth] = useState(0);
    const observer = useRef<ResizeObserver | null>(null);
    const ref = useCallback((el: T | null) => {
        observer.current?.disconnect();
        observer.current = null;
        if (!el) return;
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        observer.current = ro;
        setWidth(el.clientWidth);
    }, []);
    return [ref, width] as const;
}
