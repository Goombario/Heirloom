'use client';

import { useCallback, useRef } from 'react';

/**
 * Shrinks a heading so it stays on one line, in 2px steps, down to `minRatio`
 * of its CSS size; below that floor it is left to wrap (#741). A callback ref,
 * so it also measures a heading that mounts late.
 *
 * The result is written as `calc(<token> * ratio)` rather than px, so the size
 * follows user zoom and text scaling. It re-fits when the heading's column
 * resizes, its text changes, or web fonts finish loading. The style is set on
 * the element directly: re-rendering React state for a measurement would paint
 * the unfitted size first.
 */
export function useFitOneLine<T extends HTMLElement>({ token, minRatio }: { token: string; minRatio: number }) {
    const cleanup = useRef<(() => void) | null>(null);
    return useCallback((el: T | null) => {
        cleanup.current?.();
        cleanup.current = null;
        if (!el) return;

        const fit = () => {
            el.style.fontSize = '';
            el.style.whiteSpace = 'nowrap';
            const base = parseFloat(getComputedStyle(el).fontSize);
            const fits = () => el.scrollWidth <= el.clientWidth;
            let ratio = 1;
            if (base > 0 && !fits()) {
                const floor = base * minRatio;
                let size = base;
                while (size - 2 >= floor && !fits()) {
                    size -= 2;
                    el.style.fontSize = `${size}px`;
                }
                if (!fits()) size = floor; // below the floor: wrap at the floor size
                ratio = size / base;
            }
            el.style.whiteSpace = '';
            el.style.fontSize = ratio < 1 ? `calc(var(${token}) * ${ratio.toFixed(3)})` : '';
            if (ratio < 1) el.dataset.fitRatio = ratio.toFixed(3);
            else delete el.dataset.fitRatio;
        };

        fit();
        let frame = 0;
        const refit = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
        const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit);
        if (el.parentElement) resize?.observe(el.parentElement);
        const mutation = new MutationObserver(refit);
        mutation.observe(el, { childList: true, characterData: true, subtree: true });
        let alive = true;
        document.fonts?.ready.then(() => { if (alive) fit(); });
        cleanup.current = () => {
            alive = false;
            cancelAnimationFrame(frame);
            resize?.disconnect();
            mutation.disconnect();
        };
    }, [token, minRatio]);
}
