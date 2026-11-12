'use client';

import { useCallback, useSyncExternalStore } from 'react';

/*
 * When this browser last downloaded a backup of a tree (#60's "the row shows when
 * the last backup was made"). It is a per-device convenience: the server keeps no
 * record of downloads, so another device or a cleared browser shows none.
 */

const EVENT = 'heirloom:last-backup';
const key = (treeId: number | null) => `heirloom.lastBackup.${treeId ?? 'default'}`;

function subscribe(onChange: () => void) {
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
        window.removeEventListener(EVENT, onChange);
        window.removeEventListener('storage', onChange);
    };
}

/** The last backup's time (ms) for this tree on this device, and a way to record one. */
export function useLastBackup(treeId: number | null): [number | null, () => void] {
    const read = () => {
        try {
            const value = Number(window.localStorage.getItem(key(treeId)));
            return Number.isFinite(value) && value > 0 ? value : null;
        } catch {
            return null;
        }
    };
    const at = useSyncExternalStore(subscribe, read, () => null);
    const mark = useCallback(() => {
        try { window.localStorage.setItem(key(treeId), String(Date.now())); } catch { /* storage blocked: nothing to show */ }
        window.dispatchEvent(new Event(EVENT));
    }, [treeId]);
    return [at, mark];
}
