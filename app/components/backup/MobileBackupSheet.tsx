'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DRIVE_ENABLED } from '@/lib/data/drive/config';
import { connectDrive, isDriveConnected } from '@/lib/data/drive/auth';
import { backupToDrive } from '@/lib/data/drive/backup';
import { DRIVE_BACKUP_KEY, notifyBackup } from '@/lib/data/backup-status';
import { CloudUpload, Download, Loader2, Lock, RotateCcw } from '@/lib/icons';
import { CopperPill, MobileRow, showChangeToast } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import RestoreProgress from './RestoreProgress';
import RestoreTotalsTable from './RestoreTotalsTable';
import { useBackupOverdue } from './useBackupStatus';
import { useFileBackup } from './useFileBackup';
import { useIsDesktopApp } from '@/app/hooks/useIsDesktopApp';

/** "2 Sep", or "2 Sep 2025" outside this year. */
function shortDate(date: Date, locale: string): string {
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(date);
}

/**
 * Backup on a phone (#1130): a small sheet. The status in serif ("Last backup 2 Sep" with
 * an Overdue tag, or "Backed up today"), the copper Download backup pill, then rows for
 * Google Drive (when this build has it), restoring a backup file and keeping the data on
 * this device. The backup file is the same full snapshot the desktop panel saves.
 */
export function MobileBackupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
    const t = useTranslations('mobileBackup');
    const to = useTranslations('options');
    const desktop = useIsDesktopApp();
    const locale = useLocale();
    const { timestamp } = useTimestamp();
    const { lastBackup, ageDays, overdue } = useBackupOverdue();
    const file = useFileBackup();
    const [drive, setDrive] = useState<{ connected: boolean; last: string | null }>({ connected: false, last: null });
    const [driveBusy, setDriveBusy] = useState(false);
    const [driveError, setDriveError] = useState(false);

    useEffect(() => {
        if (!open || !DRIVE_ENABLED) return;
        setDrive({ connected: isDriveConnected(), last: localStorage.getItem(DRIVE_BACKUP_KEY) });
    }, [open]);

    async function download() {
        const name = await file.backup();
        if (name) showChangeToast({ message: t('saved_toast'), detail: name });
    }

    async function backUpToDrive() {
        setDriveError(false);
        setDriveBusy(true);
        try {
            if (!isDriveConnected()) await connectDrive();
            await backupToDrive();
            const now = new Date().toISOString();
            localStorage.setItem(DRIVE_BACKUP_KEY, now);
            setDrive({ connected: true, last: now });
            notifyBackup();
            showChangeToast({ message: t('drive_done') });
        } catch {
            setDriveError(true);
        } finally {
            setDriveBusy(false);
        }
    }

    const today = ageDays === 0;
    const reading = file.restoreStatus === 'reading';

    return (
        <Sheet open={open} onClose={onClose} title={to('backup_modal_title')} size="fit">
            <div className="-mx-4 -mt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                <div className="grid gap-1 px-4 pt-3.5 pb-0.5">
                    <span className="flex flex-wrap items-center gap-2 serif text-xl font-semibold text-text">
                        {today ? t('backed_up_today') : lastBackup ? t('last_backup', { date: shortDate(lastBackup, locale) }) : t('no_backup_yet')}
                        {overdue && <span className="font-sans text-xs font-semibold text-warning-text px-2 py-0.5 rounded-full bg-warning-bg">{to('backup_overdue')}</span>}
                    </span>
                    <p className="m-0 text-sm leading-normal text-text-secondary">
                        {lastBackup && !overdue ? t('body_fresh', { when: timestamp(lastBackup) }) : t(desktop ? 'body_overdue_desktop' : 'body_overdue')}
                    </p>
                </div>

                <div className="px-4 pt-3.5 pb-2">
                    <CopperPill icon={file.backupBusy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                        disabled={file.backupBusy} aria-busy={file.backupBusy} onClick={() => { void download(); }}>
                        {file.backupBusy ? to('backup_saving') : t('download')}
                    </CopperPill>
                    {file.backupError && <p role="alert" className="m-0 pt-2 text-sm text-error">{file.backupError}</p>}
                </div>

                {DRIVE_ENABLED && (
                    <MobileRow divided icon={driveBusy ? <Loader2 className="animate-spin" /> : <CloudUpload />} label={t('drive')}
                        sub={driveBusy ? t('drive_busy') : driveError ? to('drive_error')
                            : drive.last ? t('drive_last', { date: shortDate(new Date(drive.last), locale) })
                                : drive.connected ? undefined : t('drive_connect')}
                        disabled={driveBusy} onClick={() => { void backUpToDrive(); }} />
                )}

                <input ref={file.fileInputRef} type="file" accept=".hlbak" className="hidden" onChange={file.onFileChange} />
                <MobileRow divided icon={reading ? <Loader2 className="animate-spin" /> : <RotateCcw />} label={t('restore')}
                    sub={reading ? to('restore_reading') : file.restoreError ?? t(desktop ? 'restore_sub_desktop' : 'restore_sub')}
                    disabled={reading || file.restoreStatus === 'restoring'} onClick={file.chooseFile} />

                {!desktop && (
                    <MobileRow divided icon={<Lock />} label={t('persist')}
                        sub={file.persistDenied ? to('storage_request_denied') : t('persist_sub')}
                        value={file.isPersistent === true ? t('persist_on') : file.isPersistent === false ? t('persist_off') : t('persist_unknown')}
                        onClick={file.isPersistent === false ? () => { void file.requestPersist(); } : undefined} />
                )}
            </div>

            <ConfirmSheet
                open={file.restoreStatus === 'confirming' && file.pending != null}
                title={to('restore_confirm_title')}
                body={(
                    <>
                        <p className="m-0 mb-1">{to(desktop ? 'restore_confirm_body_desktop' : 'restore_confirm_body')}</p>
                        {file.pending && (
                            <>
                                <p className="m-0 font-medium text-text">{file.pending.file.name}</p>
                                <RestoreTotalsTable current={file.pending.current} backup={file.pending.backup} backupDate={new Date(file.pending.file.lastModified)} />
                            </>
                        )}
                    </>
                )}
                confirmLabel={to('restore_confirm')}
                keepLabel={to('restore_cancel')}
                onConfirm={() => { void file.confirmRestore(); }}
                // Once the restore runs it can't be called back; the page reloads when it ends.
                onClose={() => { if (file.restoreStatus !== 'restoring') file.cancelRestore(); }}
            />
            <RestoreProgress phase={file.restoreStatus === 'reading' || file.restoreStatus === 'restoring' ? file.restoreStatus : null} />
        </Sheet>
    );
}
