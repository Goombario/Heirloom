'use client';

import { useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import { Button, DialogHeader, cx } from '@/app/components/ui';
import { Check, Database, Download } from '@/lib/icons';
import { itemText } from '@/lib/whats-new';
import { openInSystemBrowser } from '@/lib/desktop';
import type { LatestRelease } from '@/lib/updates';
import { downloadUpdate, installAndRestart, saveBackupToDownloads, type InstallMode } from './updateSteps';

type Phase =
    | { kind: 'offer' }
    | { kind: 'running'; step: 'backup' | 'download' | 'install'; file?: string; got?: number; total?: number | null }
    | { kind: 'backup_failed'; reason: string }
    | { kind: 'failed'; file?: string; reason: string };

const MB = 1024 * 1024;

function StepMark({ state }: { state: 'done' | 'running' | 'waiting' | 'bad' }) {
    return (
        <span
            aria-hidden="true"
            className={cx(
                'mt-0.5 inline-flex w-5 h-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                state === 'done' && 'bg-success-bg text-success',
                state === 'running' && 'border-2 border-text border-t-transparent animate-spin',
                state === 'waiting' && 'border-2 border-border',
                state === 'bad' && 'bg-warning-bg text-warning-text border border-warning-border',
            )}
        >
            {state === 'done' ? <Check className="w-3 h-3" /> : state === 'bad' ? '!' : null}
        </span>
    );
}

/**
 * The update dialog (#24, mockup A): which version is ready, three What's new
 * lines and the backup note, then Later or Update now. Update now runs the steps
 * in order (backup to Downloads, download, install and restart); if the backup
 * can't be saved, nothing is downloaded or installed. On Linux, and on a build
 * without the updater, the main action opens the release page instead, with Back
 * up now beside it.
 */
export default function UpdateDialog({ open, onClose, release, current, mode }: {
    open: boolean;
    onClose: () => void;
    release: LatestRelease;
    current: string;
    mode: InstallMode;
}) {
    const t = useTranslations('updates');
    const locale = useLocale();
    const titleId = useId();
    const [phase, setPhase] = useState<Phase>({ kind: 'offer' });
    const [backedUp, setBackedUp] = useState<string | null>(null);
    const [backingUp, setBackingUp] = useState(false);
    const cancelled = useRef(false);
    const running = phase.kind === 'running';
    const version = release.version;

    async function updateNow() {
        cancelled.current = false;
        setPhase({ kind: 'running', step: 'backup' });
        let file: string;
        try {
            file = await saveBackupToDownloads();
        } catch (err) {
            setPhase({ kind: 'backup_failed', reason: err instanceof Error ? err.message : String(err) });
            return;
        }
        if (cancelled.current) return;
        setPhase({ kind: 'running', step: 'download', file, got: 0, total: null });
        try {
            await downloadUpdate((got, total) => {
                if (!cancelled.current) setPhase({ kind: 'running', step: 'download', file, got, total });
            });
            if (cancelled.current) return;
            setPhase({ kind: 'running', step: 'install', file });
            await installAndRestart();
        } catch (err) {
            if (!cancelled.current) setPhase({ kind: 'failed', file, reason: err instanceof Error ? err.message : String(err) });
        }
    }

    function cancel() {
        cancelled.current = true;
        setPhase({ kind: 'offer' });
        onClose();
    }

    async function backUpNow() {
        setBackingUp(true);
        try {
            setBackedUp(await saveBackupToDownloads());
        } catch (err) {
            setPhase({ kind: 'backup_failed', reason: err instanceof Error ? err.message : String(err) });
        } finally {
            setBackingUp(false);
        }
    }

    const close = running ? () => {} : () => { if (phase.kind !== 'offer') setPhase({ kind: 'offer' }); onClose(); };
    const seeAll = (
        <button type="button" onClick={() => void openInSystemBrowser(release.url)} className="text-sm text-link underline hover:no-underline focus-ring rounded bg-transparent border-0 p-0 cursor-pointer">
            {t('see_everything')}
        </button>
    );

    let title: string;
    let body: React.ReactNode;
    let actions: React.ReactNode;
    if (phase.kind === 'offer') {
        title = t(mode === 'auto' ? 'ready_title' : 'available_title', { version });
        body = (
            <>
                <p className="m-0 -mt-2 text-sm text-text-muted">{t('you_have', { current })}</p>
                {release.notes.length > 0 && (
                    <ul className="m-0 pl-5 list-disc flex flex-col gap-1.5 text-sm text-text-secondary">
                        {release.notes.map((item, i) => <li key={i}>{itemText(item, locale)}</li>)}
                    </ul>
                )}
                <p className="m-0">{seeAll}</p>
                <div className="flex gap-2.5 items-start rounded-lg bg-card-alt border border-border px-3 py-2.5 text-sm text-text-secondary">
                    {mode === 'auto'
                        ? <Database className="w-4 h-4 mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
                        : <Download className="w-4 h-4 mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />}
                    <span>{mode === 'auto' ? t('backup_note_auto', { current }) : t('backup_note_manual', { current })}</span>
                </div>
                {backedUp && <p className="m-0 text-sm text-text-secondary" role="status">{t('backup_saved_to', { file: backedUp })}</p>}
            </>
        );
        actions = mode === 'auto' ? (
            <>
                <Button variant="ghost" onClick={close}>{t('later')}</Button>
                <Button variant="primary" onClick={() => void updateNow()}>{t('update_now')}</Button>
            </>
        ) : (
            <>
                <Button variant="ghost" onClick={close}>{t('later')}</Button>
                <Button variant="outline" disabled={backingUp} onClick={() => void backUpNow()}>{backingUp ? t('backing_up') : t('back_up_now')}</Button>
                <Button variant="primary" onClick={() => void openInSystemBrowser(release.url)}>{t('open_release_page')}</Button>
            </>
        );
    } else if (phase.kind === 'running') {
        const order = ['backup', 'download', 'install'] as const;
        const at = order.indexOf(phase.step);
        const state = (i: number) => (i < at ? 'done' : i === at ? 'running' : 'waiting') as 'done' | 'running' | 'waiting';
        const pct = phase.total ? Math.min(100, Math.round(((phase.got ?? 0) / phase.total) * 100)) : null;
        title = t('updating_title', { version });
        body = (
            <ol className="m-0 p-0 list-none flex flex-col gap-3.5 text-sm" aria-live="polite">
                <li className="flex gap-3">
                    <StepMark state={state(0)} />
                    <div>{at > 0 ? t('step_backup_done') : t('step_backup')}
                        {phase.file && <div className="text-meta text-text-muted">{t.rich('backup_file', { file: phase.file, mono: (c) => <span className="font-mono">{c}</span> })}</div>}
                    </div>
                </li>
                <li className="flex gap-3">
                    <StepMark state={state(1)} />
                    <div className="flex-1">{t('step_download', { version })}
                        {phase.step === 'download' && (
                            <>
                                <div className="text-meta text-text-muted">
                                    {phase.total ? t('download_progress', { got: Math.round((phase.got ?? 0) / MB), total: Math.round(phase.total / MB) }) : t('download_starting')}
                                </div>
                                <div className="mt-1.5 h-1.5 rounded-full bg-surface-2 overflow-hidden" role="progressbar" aria-label={t('step_download', { version })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
                                    <div className="h-full bg-text rounded-full transition-[width]" style={{ width: `${pct ?? 4}%` }} />
                                </div>
                            </>
                        )}
                    </div>
                </li>
                <li className="flex gap-3">
                    <StepMark state={state(2)} />
                    <div>{t('step_install')}<div className="text-meta text-text-muted">{t('step_install_hint')}</div></div>
                </li>
            </ol>
        );
        actions = phase.step === 'install' ? null : <Button variant="ghost" onClick={cancel}>{t('cancel')}</Button>;
    } else {
        const backup = phase.kind === 'backup_failed';
        title = t('paused_title');
        body = (
            <ol className="m-0 p-0 list-none flex flex-col gap-3.5 text-sm" role="alert">
                <li className="flex gap-3">
                    <StepMark state={backup ? 'bad' : 'done'} />
                    <div>
                        {backup ? t.rich('backup_failed', { b: (c) => <b className="font-semibold">{c}</b> }) : t('step_backup_done')}
                        {backup
                            ? <div className="text-meta text-text-muted">{t('backup_failed_hint')}</div>
                            : phase.file && <div className="text-meta text-text-muted">{t.rich('backup_file', { file: phase.file, mono: (c) => <span className="font-mono">{c}</span> })}</div>}
                    </div>
                </li>
                <li className="flex gap-3">
                    <StepMark state={backup ? 'waiting' : 'bad'} />
                    <div className={backup ? 'text-text-muted' : undefined}>
                        {backup ? t('step_download', { version }) : t.rich('install_failed', { b: (c) => <b className="font-semibold">{c}</b> })}
                        {!backup && <div className="text-meta text-text-muted">{t('install_failed_hint')}</div>}
                    </div>
                </li>
                {backup && <li className="flex gap-3"><StepMark state="waiting" /><div className="text-text-muted">{t('step_install')}</div></li>}
            </ol>
        );
        actions = (
            <>
                <Button variant="ghost" onClick={close}>{t('later')}</Button>
                <Button variant="primary" onClick={() => (mode === 'auto' ? void updateNow() : void backUpNow().then(() => setPhase({ kind: 'offer' })))}>{t('try_again')}</Button>
            </>
        );
    }

    return (
        <Modal open={open} onClose={close} size="form" labelledBy={titleId} disableClose={running}>
            <div className="bg-card rounded-2xl shadow-xl p-6 flex flex-col gap-4 max-h-[85dvh]">
                <DialogHeader title={title} titleId={titleId} onClose={running ? undefined : close} />
                <div className="min-h-0 flex-1 overflow-auto scroll-area flex flex-col gap-3">{body}</div>
                {actions && <div className="flex justify-end gap-2">{actions}</div>}
            </div>
        </Modal>
    );
}
