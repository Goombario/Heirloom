'use client';

import { useSyncExternalStore } from 'react';
import { LETTER_SHORTCUTS_EVENT, isMacPlatform, readLetterShortcuts } from '@/lib/keyboard/shortcuts';

function subscribeLetters(onChange: () => void) {
    window.addEventListener(LETTER_SHORTCUTS_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
        window.removeEventListener(LETTER_SHORTCUTS_EVENT, onChange);
        window.removeEventListener('storage', onChange);
    };
}

/** The Options › Keyboard "Letter shortcuts" switch (#32), on by default and kept in step across tabs. */
export function useLetterShortcuts(): boolean {
    return useSyncExternalStore(subscribeLetters, readLetterShortcuts, () => true);
}

const noSubscribe = () => () => {};

/** True on a Mac, where shortcuts say ⌘ rather than Ctrl. False while prerendering. */
export function useIsMac(): boolean {
    return useSyncExternalStore(noSubscribe, isMacPlatform, () => false);
}
