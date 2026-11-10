import { useLayoutEffect } from 'react';

/**
 * The phone person and family pages' hero replaces the app top bar (#1099), as the
 * home band and list headers do. globals.css hides the bar below md and drops --nav-h
 * to 0, so the slim bar takes the top edge and pads itself clear of the notch.
 */
export function useHeroHeader() {
    useLayoutEffect(() => {
        const root = document.documentElement;
        root.setAttribute('data-own-header', 'hero');
        return () => root.removeAttribute('data-own-header');
    }, []);
}
