'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useFormatter, useNow } from 'next-intl';

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

/** A backup older than this many days counts as old: Restore warns again (#193). */
export const BACKUP_OLD_AFTER_DAYS = 30;

/** How the last backup on this device stands: none, recent, or old. */
export type BackupAge = { kind: 'none' } | { kind: 'recent' | 'old'; at: number };

export function backupAge(at: number | null, now: number): BackupAge {
    if (at == null) return { kind: 'none' };
    return { kind: now - at > BACKUP_OLD_AFTER_DAYS * 86_400_000 ? 'old' : 'recent', at };
}

/**
 * The last backup on this device for Restore and Add from a file (#193): its age
 * ("3 days ago", in the reader's language) and whether it is none, recent or old.
 * The date is per device: the server keeps no record of downloads.
 */
export function useBackupAge(treeId: number | null): { age: BackupAge; when: string | null; mark: () => void } {
    const [at, mark] = useLastBackup(treeId);
    const format = useFormatter();
    const now = useNow({ updateInterval: 60_000 });
    const age = backupAge(at, now.getTime());
    const when = age.kind === 'none' ? null : format.relativeTime(age.at, now);
    return { age, when, mark };
}
