'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { MobileImportExportProps } from '../MobileImportExport';
import { ImportHub } from './ImportHub';
import { FileJob } from './FileJob';
import { SpreadsheetJob } from './SpreadsheetJob';

export type Job = 'add' | 'spreadsheet' | 'restore';
const JOBS: readonly Job[] = ['add', 'spreadsheet', 'restore'];

/** What every desktop view reads: the phone's props plus the preflight's Review. */
export interface ImportViewProps extends MobileImportExportProps {
    /** Closes the export preflight and shows the photos still to finish. */
    onPreflightReview: () => void;
}

interface DesktopImportExportProps extends ImportViewProps {
    /** The hub's leftover-photos region, which the preflight's Review focuses. */
    recoveryRef: React.RefObject<HTMLDivElement | null>;
}

// The job lives in the URL (`?job=add`), so each job is its own page with a working
// Back button, while the import state stays in the one page component above.
const JOB_EVENT = 'heirloom:import-job';
function subscribe(onChange: () => void) {
    window.addEventListener('popstate', onChange);
    window.addEventListener(JOB_EVENT, onChange);
    return () => {
        window.removeEventListener('popstate', onChange);
        window.removeEventListener(JOB_EVENT, onChange);
    };
}
function readJob(): Job | null {
    const value = new URLSearchParams(window.location.search).get('job');
    return JOBS.includes(value as Job) ? (value as Job) : null;
}

/**
 * Import and export on desktop (#60): the hub, and one page per job (Add from a
 * file, Add from a spreadsheet, Restore a backup). The page owns every import and
 * export, exactly as it does for the phone; this is only how a desktop shows it.
 */
export function DesktopImportExport({ recoveryRef, ...p }: DesktopImportExportProps) {
    const job = useSyncExternalStore(subscribe, readJob, () => null);
    const canImport = p.permission !== 'view';
    const canReplace = p.permission === 'owner' || p.permission === 'edit';
    // A job the person can't do (a viewer's link to Restore) shows the hub instead.
    const shown: Job | null = job === 'restore' ? (canReplace ? job : null) : job && canImport ? job : null;

    const go = useCallback((next: Job | null) => {
        const url = new URL(window.location.href);
        if (next) url.searchParams.set('job', next); else url.searchParams.delete('job');
        window.history.pushState(null, '', url.pathname + url.search + url.hash);
        window.dispatchEvent(new Event(JOB_EVENT));
        window.scrollTo({ top: 0 });
    }, []);

    // Every arrival at a job, by a click, a link or Back and Forward, starts it clean
    // with its mode: Add merges, Restore overwrites. A remount that finds work under
    // way (the page swapping layouts mid-import) picks it up instead of clearing it.
    const started = useRef<Job | null | undefined>(undefined);
    const busy = p.loading || p.result != null || p.preview != null || p.file != null || p.xlsx.phase !== 'idle' || p.xlsx.file != null;
    useEffect(() => {
        if (started.current === shown) return;
        const first = started.current === undefined;
        started.current = shown;
        if (first && busy) return;
        if (shown === 'add' || shown === 'restore') p.onStartJob(shown === 'restore' ? 'overwrite' : 'merge');
        else if (shown === 'spreadsheet') p.xlsx.onCancel();
    });

    const leave = () => {
        if (p.loading || p.xlsx.phase === 'confirming') return;
        if (p.result) p.onFinish();
        go(null);
    };

    if (shown === 'add' || shown === 'restore') return <FileJob key={shown} p={p} restore={shown === 'restore'} onLeave={leave} />;
    if (shown === 'spreadsheet') return <SpreadsheetJob p={p} onLeave={leave} onAnother={p.xlsx.onCancel} />;
    return <ImportHub p={p} recoveryRef={recoveryRef} canImport={canImport} canReplace={canReplace} onJob={go} />;
}
