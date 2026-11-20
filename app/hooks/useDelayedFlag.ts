import { useEffect, useRef, useState } from 'react';

/**
 * Returns `flag` smoothed for a busy indicator: it turns true only once `flag`
 * has stayed true for `delay`ms, and once true it stays true for at least
 * `minVisible`ms. Quick work never shows the indicator, and slow work that
 * finishes just after the delay doesn't blink it on and off.
 */
export function useDelayedFlag(flag: boolean, delay: number, minVisible = 0): boolean {
    const [shown, setShown] = useState(false);
    const shownAt = useRef(0);

    useEffect(() => {
        if (flag) {
            if (shown) return;
            const id = setTimeout(() => {
                shownAt.current = Date.now();
                setShown(true);
            }, delay);
            return () => clearTimeout(id);
        }
        if (!shown) return;
        const remaining = Math.max(0, shownAt.current + minVisible - Date.now());
        const id = setTimeout(() => setShown(false), remaining);
        return () => clearTimeout(id);
    }, [flag, shown, delay, minVisible]);

    return shown;
}
