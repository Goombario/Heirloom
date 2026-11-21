'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DATA_MODE } from '@/lib/data';
import { isDesktopApp } from '@/lib/desktop';
import BackupModal from '@/app/components/backup/BackupModal';
import { Button } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { AlertTriangle } from '@/lib/icons';
import { PERSIST_ANSWERED_EVENT, STORAGE_NOTICE_DISMISSED_KEY, readPersistState, type PersistState } from './storagePersistence';

const FIRST_RUN_SEEN_KEY = 'heirloom_local_first_run_seen';

function readFlag(key: string): boolean {
    try { return localStorage.getItem(key) != null; } catch { return false; }
}

/**
 * Whether Home should say the browser may clear the tree (#18): the in-browser
 * build only (not hosted, not the desktop app), the browser said no to keeping
 * the data for good, and nobody pressed Got it yet. On a first visit it waits
 * for the first-run request's answer, so a Firefox prompt still open never reads
 * as a refusal.
 */
function useStorageRefused(): [boolean, () => void] {
    const [show, setShow] = useState(false);
    useEffect(() => {
        if (DATA_MODE !== 'local' || isDesktopApp() || readFlag(STORAGE_NOTICE_DISMISSED_KEY)) return;
        let live = true;
        const apply = (state: PersistState) => { if (live) setShow(state === 'not_kept' && !readFlag(STORAGE_NOTICE_DISMISSED_KEY)); };
        const onAnswer = (e: Event) => apply((e as CustomEvent<PersistState>).detail);
        window.addEventListener(PERSIST_ANSWERED_EVENT, onAnswer);
        // Already asked on an earlier visit: the answer stands.
        if (readFlag(FIRST_RUN_SEEN_KEY)) void readPersistState().then(apply);
        return () => { live = false; window.removeEventListener(PERSIST_ANSWERED_EVENT, onAnswer); };
    }, []);
    const dismiss = () => {
        try { localStorage.setItem(STORAGE_NOTICE_DISMISSED_KEY, '1'); } catch { /* shown again next time */ }
        setShow(false);
    };
    return [show, dismiss];
}

/**
 * "This browser may clear your tree", shown once (#18, mockup option A). Desktop:
 * a white panel with the warning edge under Home's band, with Back up now, How
 * to keep it and Got it. Phone: the same message as a one-time sheet over Home,
 * which itself doesn't change. Got it hides it for good; the Backups page keeps
 * showing the status after that.
 */
export default function StorageNotice({ placement }: { placement: 'desktop' | 'phone' }) {
    const t = useTranslations('storageNotice');
    const [show, dismiss] = useStorageRefused();
    const [howOpen, setHowOpen] = useState(false);
    const [backupOpen, setBackupOpen] = useState(false);
    const titleId = useId();
    const howId = useId();

    const backupModal = <BackupModal open={backupOpen} onClose={() => setBackupOpen(false)} />;

    if (placement === 'phone') {
        return (
            <>
                <Sheet open={show} onClose={dismiss} title={t('title')} hideHeader>
                    <div className="grid gap-3 pb-2">
                        <h2 className="m-0 serif text-lg font-semibold text-text">{t('title')}</h2>
                        <p className="m-0 text-base text-text-secondary">{t('body_short')}</p>
                        {/* The sheet is one-time: backing up from it counts as seen. */}
                        <Button variant="primary" size="lg" block onClick={() => { dismiss(); setBackupOpen(true); }}>{t('back_up_now')}</Button>
                        <Button variant="ghost" size="lg" block onClick={dismiss}>{t('got_it')}</Button>
                    </div>
                </Sheet>
                {backupModal}
            </>
        );
    }

    if (!show) return backupModal;
    return (
        <>
            <section aria-labelledby={titleId}
                className="storage-notice relative mt-6 flex gap-3.5 overflow-hidden rounded-panel border border-border bg-card p-5 pl-6 shadow-card before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-warning-edge">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-warning-bg text-warning-text">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                    <h2 id={titleId} className="m-0 text-base font-semibold text-text">{t('title')}</h2>
                    <p className="m-0 mt-1 text-sm text-text-secondary">{t('body')}</p>
                    {howOpen && <p id={howId} className="m-0 mt-2 text-sm text-text-secondary">{t('how_body')}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="primary" size="sm" onClick={() => setBackupOpen(true)}>{t('back_up_now')}</Button>
                        <Button variant="outline" size="sm" aria-expanded={howOpen} aria-controls={howOpen ? howId : undefined} onClick={() => setHowOpen((o) => !o)}>
                            {t('how_to_keep')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={dismiss}>{t('got_it')}</Button>
                    </div>
                </div>
            </section>
            {backupModal}
        </>
    );
}
