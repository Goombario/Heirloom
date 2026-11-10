'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { DRIVE_ENABLED } from '@/lib/data/drive/config';
import { connectDrive, disconnectDrive, isDriveConnected } from '@/lib/data/drive/auth';
import { backupToDrive, listDriveBackups, inspectDriveBackup, type DriveFile } from '@/lib/data/drive/backup';
import { restoreErrorKey } from '@/lib/db/restore-errors';
import { getDatabaseTotals, loadDatabase, type DatabaseTotals } from '@/lib/db/connection.pglite';
import { notifyBackup } from '@/lib/data/backup-status';
import { Button } from '@/app/components/ui';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import RestoreTotalsTable from '@/app/components/backup/RestoreTotalsTable';
import RestoreProgress from '@/app/components/backup/RestoreProgress';
import { Cloud, CloudUpload, CloudDownload, CloudOff } from '@/lib/icons';

import { useTimestamp } from '@/app/hooks/useTimestamp';

const LAST_DRIVE_BACKUP_KEY = 'heirloom_last_drive_backup';

/**
 * Manual Google Drive backup/restore for the local-first build.
 *
 * Renders nothing unless `DRIVE_ENABLED` (local build + a configured client ID),
 * so forks without a Google client ID never see it. Standalone for now — final
 * placement in the options UI is a follow-up decision.
 */
export default function DriveBackupSection() {
  const t = useTranslations('options');
  const { timestamp } = useTimestamp();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore picker state
  const [loadingList, setLoadingList] = useState(false);
  const [backups, setBackups] = useState<DriveFile[] | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'reading' | 'confirming' | 'restoring'>('idle');
  // The backup being read, then its download already rebuilt and counted, so the
  // confirmation compares it with this browser (BK-1, #850) and confirming
  // restores exactly what was inspected, without a second download.
  const [reading, setReading] = useState<DriveFile | null>(null);
  const [pending, setPending] = useState<{
    file: DriveFile;
    datadir: Blob;
    backup: DatabaseTotals;
    current: DatabaseTotals | null;
  } | null>(null);
  const restoreBusy = restoreStatus === 'reading' || restoreStatus === 'restoring';

  useEffect(() => {
    setConnected(isDriveConnected());
    const stored = localStorage.getItem(LAST_DRIVE_BACKUP_KEY);
    if (stored) setLastBackup(stored);
  }, []);

  async function handleConnect() {
    setError(null);
    setConnecting(true);
    try {
      await connectDrive();
      setConnected(true);
    } catch {
      setError(t('drive_error'));
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setError(null);
    await disconnectDrive();
    setConnected(false);
    setBackups(null);
  }

  async function handleBackup() {
    setError(null);
    setBackingUp(true);
    try {
      await backupToDrive();
      const now = new Date().toISOString();
      localStorage.setItem(LAST_DRIVE_BACKUP_KEY, now);
      setLastBackup(now);
      notifyBackup();
      // A fresh backup may have changed the list — drop any cached picker list.
      setBackups(null);
    } catch {
      setError(t('drive_error'));
    } finally {
      setBackingUp(false);
    }
  }

  async function handleOpenPicker() {
    setError(null);
    setLoadingList(true);
    try {
      setBackups(await listDriveBackups());
    } catch {
      setError(t('drive_error'));
    } finally {
      setLoadingList(false);
    }
  }

  async function handlePick(file: DriveFile) {
    setError(null);
    setReading(file);
    setRestoreStatus('reading');
    try {
      // Read-only: an unreadable backup is rejected here, before anything is replaced.
      const { datadir, totals } = await inspectDriveBackup(file.id);
      const current = await getDatabaseTotals().catch(() => null);
      setPending({ file, datadir, backup: totals, current });
      setRestoreStatus('confirming');
    } catch (err) {
      setError(t(restoreErrorKey(err)));
      setRestoreStatus('idle');
    } finally {
      setReading(null);
    }
  }

  async function handleRestoreConfirm() {
    if (!pending) return;
    const { file, datadir } = pending;
    setRestoreStatus('restoring');
    try {
      await loadDatabase(datadir);
      // Record that a Drive backup exists as of the restored file's date. Backup
      // markers live in localStorage, NOT in the DB dump — so without this a
      // restore into a fresh browser (or Incognito) shows "no backup yet" and
      // fires the stale-backup nudge even though we just restored from Drive.
      localStorage.setItem(LAST_DRIVE_BACKUP_KEY, file.modifiedTime);
      notifyBackup();
      setRestoreStatus('idle');
      alert(t('restore_success'));
      window.location.reload();
    } catch (err) {
      setError(t(restoreErrorKey(err)));
      setRestoreStatus('idle');
    } finally {
      setPending(null);
    }
  }

  if (!DRIVE_ENABLED) return null;

  return (
    <section id="drive-backup" aria-label={t('drive_title')}>
      <div className="flex items-center gap-2 mb-1">
        <Cloud className="w-5 h-5 text-text-muted" aria-hidden="true" />
        <h3 className="text-base font-semibold text-text">{t('drive_title')}</h3>
      </div>
      <p className="text-text-muted text-sm mb-4">{t('drive_desc')}</p>

      {error && <p className="text-sm text-error mb-3" role="alert">{error}</p>}

      {!connected ? (
        <Button variant="primary" onClick={handleConnect} disabled={connecting}>
          <Cloud className="w-4 h-4" aria-hidden="true" />
          {connecting ? t('drive_connecting') : t('drive_connect')}
        </Button>
      ) : (
        <>
          <p className="text-xs text-text-muted mb-3">
            {lastBackup ? t('drive_backup_last', { date: timestamp(lastBackup) }) : t('drive_backup_never')}
          </p>

          <div className="flex flex-wrap gap-3 mb-4">
            <Button variant="primary" onClick={handleBackup} disabled={backingUp}>
              <CloudUpload className="w-4 h-4" aria-hidden="true" />
              {backingUp ? t('drive_backing_up') : t('drive_backup_button')}
            </Button>
            <Button variant="outline" onClick={handleOpenPicker} disabled={loadingList || restoreBusy}>
              <CloudDownload className="w-4 h-4" aria-hidden="true" />
              {loadingList ? t('drive_restore_loading') : t('drive_restore_button')}
            </Button>
            <Button variant="ghost" onClick={handleDisconnect} title={t('drive_disconnect')}>
              <CloudOff className="w-4 h-4" aria-hidden="true" />
              {t('drive_disconnect')}
            </Button>
          </div>

          {backups !== null && (
            backups.length === 0 ? (
              <p className="text-sm text-text-muted">{t('drive_restore_empty')}</p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label={t('drive_picker_title')}>
                {backups.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => handlePick(b)}
                      disabled={restoreBusy}
                      aria-busy={reading?.id === b.id}
                      className="w-full text-left rounded-lg border border-border px-3 py-2 hover:bg-[color:var(--color-hover-surface)] focus-ring transition-colors disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="block text-sm text-text-secondary">{b.name}</span>
                      <span className="block text-xs text-text-muted">
                        {reading?.id === b.id ? t('restore_reading') : timestamp(b.modifiedTime)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </>
      )}

      <ConfirmDialog
        open={restoreStatus === 'confirming' && pending != null}
        variant="calm"
        tone="danger"
        title={t('restore_confirm_title')}
        body={
          <>
            <p className="text-sm text-text-muted mb-1">{t('restore_confirm_body')}</p>
            {pending && (
              <>
                <p className="text-sm font-medium text-text">{pending.file.name}</p>
                <RestoreTotalsTable current={pending.current} backup={pending.backup} backupDate={pending.file.modifiedTime} />
              </>
            )}
          </>
        }
        confirmLabel={t('restore_confirm')}
        cancelLabel={t('restore_cancel')}
        onConfirm={handleRestoreConfirm}
        // Cancel drops the downloaded backup; nothing was replaced.
        onCancel={() => { setRestoreStatus('idle'); setPending(null); }}
      />
      <RestoreProgress phase={restoreStatus === 'reading' || restoreStatus === 'restoring' ? restoreStatus : null} />
    </section>
  );
}
