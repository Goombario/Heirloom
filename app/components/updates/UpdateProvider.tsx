'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { isDesktopApp } from '@/lib/desktop';
import { aboutInfo } from '@/lib/about';
import { DEFAULT_SOURCE_URL } from '@/lib/about/build-env';
import {
    checkIsDue, fetchLatestRelease, isNewer, knownLatest, markPrompted, recordCheck, repoFromSourceUrl,
    setUpdateChecksEnabled, shouldPrompt, updateChecksEnabled, type LatestRelease,
} from '@/lib/updates';
import { detectInstallMode, type InstallMode } from './updateSteps';
import UpdateDialog from './UpdateDialog';

export type CheckState = 'idle' | 'checking' | 'up_to_date' | 'failed';

interface UpdateContextValue {
    /** True in the desktop app, the only build that updates this way. */
    desktop: boolean;
    current: string;
    /** A newer release than the running one, once found. */
    available: LatestRelease | null;
    mode: InstallMode | null;
    enabled: boolean;
    setEnabled: (on: boolean) => void;
    checkState: CheckState;
    checkNow: () => void;
    openDialog: () => void;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

const noSubscribe = () => () => {};
const storage = () => { try { return window.localStorage; } catch { return null; } };

/** The repository to ask: the build's source link, or the project's own. */
function repo(): string | null {
    return repoFromSourceUrl(aboutInfo().sourceUrl || DEFAULT_SOURCE_URL);
}

/**
 * Desktop updates (#24): once a day, while Check for updates is on, ask GitHub
 * for the newest release. A newer one opens the update dialog once per version;
 * after Later, the top-bar chip and Options › Updates offer it. Outside the
 * desktop app this provides an inert value and never contacts anything.
 */
export function UpdateProvider({ children }: { children: React.ReactNode }) {
    const desktop = useSyncExternalStore(noSubscribe, isDesktopApp, () => false);
    const current = aboutInfo().version;
    const [available, setAvailable] = useState<LatestRelease | null>(null);
    const [mode, setMode] = useState<InstallMode | null>(null);
    const [enabled, setEnabledState] = useState(() => typeof window === 'undefined' || updateChecksEnabled(storage()));
    const [checkState, setCheckState] = useState<CheckState>('idle');
    const [open, setOpen] = useState(false);

    const take = useCallback(async (latest: LatestRelease | null, prompt: boolean) => {
        if (!latest || !isNewer(latest.version, current)) { setAvailable(null); return false; }
        setAvailable(latest);
        setMode(await detectInstallMode(latest));
        if (prompt && shouldPrompt(storage(), latest.version)) {
            markPrompted(storage(), latest.version);
            setOpen(true);
        }
        return true;
    }, [current]);

    const check = useCallback(async (prompt: boolean) => {
        const r = repo();
        if (!r) return;
        setCheckState('checking');
        try {
            const latest = await fetchLatestRelease(r);
            recordCheck(storage(), Date.now(), latest);
            const newer = await take(latest, prompt);
            setCheckState(newer ? 'idle' : 'up_to_date');
        } catch (err) {
            console.warn('Update check failed:', err);
            setCheckState('failed');
        }
    }, [take]);

    useEffect(() => {
        if (!desktop) return;
        if (!updateChecksEnabled(storage())) return;
        // What the last check found shows straight away (the chip), without asking
        // GitHub again; a due check waits for a calm moment after the app opens.
        const known = window.setTimeout(() => void take(knownLatest(storage()), true), 0);
        const due = checkIsDue(storage(), Date.now()) ? window.setTimeout(() => void check(true), 5000) : undefined;
        return () => { window.clearTimeout(known); window.clearTimeout(due); };
    }, [desktop, check, take]);

    const value = useMemo<UpdateContextValue>(() => ({
        desktop,
        current,
        available,
        mode,
        enabled,
        setEnabled: (on) => {
            setUpdateChecksEnabled(storage(), on);
            setEnabledState(on);
            if (!on) { setAvailable(null); setCheckState('idle'); }
        },
        checkState,
        checkNow: () => void check(false),
        openDialog: () => setOpen(true),
    }), [desktop, current, available, mode, enabled, checkState, check]);

    return (
        <UpdateContext.Provider value={value}>
            {children}
            {desktop && available && mode && (
                <UpdateDialog open={open} onClose={() => setOpen(false)} release={available} current={current} mode={mode} />
            )}
        </UpdateContext.Provider>
    );
}

const INERT: UpdateContextValue = {
    desktop: false, current: '', available: null, mode: null, enabled: false, setEnabled: () => {},
    checkState: 'idle', checkNow: () => {}, openDialog: () => {},
};

export function useUpdates(): UpdateContextValue {
    return useContext(UpdateContext) ?? INERT;
}
