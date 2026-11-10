'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { dumpDatabaseLogical, getDatabaseTotals, inspectBackupLogical, loadDatabase, type DatabaseTotals } from '@/lib/db/connection.pglite';
import { notifyBackup, FILE_BACKUP_KEY } from '@/lib/data/backup-status';
import { restoreErrorKey } from '@/lib/db/restore-errors';

type RestoreStatus = 'idle' | 'reading' | 'confirming' | 'restoring';

/** A chosen backup, already rebuilt and counted, so the confirmation can compare it with this browser (BK-1). */
interface PendingRestore {
  file: File;
  datadir: Blob;
  backup: DatabaseTotals;
  current: DatabaseTotals | null;
}

/**
 * The this-device backup: download a full snapshot file, restore from one, and ask the
 * browser to keep the data. Shared by the desktop section and the phone Backup sheet
 * (#1130) so the two never drift.
 */
export function useFileBackup() {
  const t = useTranslations('options');
  const [isPersistent, setIsPersistent] = useState<boolean | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>('idle');
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [persistDenied, setPersistDenied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
      navigator.storage.persisted().then(setIsPersistent).catch(() => setIsPersistent(null));
    }
  }, []);

  async function requestPersist() {
    try {
      const granted = await navigator.storage.persist();
      setIsPersistent(granted);
      // Browsers (esp. Chromium) auto-deny without engagement and return false
      // with no prompt — surface that so the button doesn't look broken.
      setPersistDenied(!granted);
    } catch {
      // API unsupported — treat like a denial for messaging purposes.
      setPersistDenied(true);
    }
  }

  /** Saves the snapshot. Resolves to the file name once saved, or null when cancelled or failed. */
  async function backup(): Promise<string | null> {
    setBackupError(null);
    const filename = `heirloom-backup-${new Date().toISOString().slice(0, 10)}.hlbak`;
    // Where the browser can say whether the file was saved, ask first: the
    // picker needs the click's user gesture, which the dump would outlast, and a
    // cancelled picker must not count as a backup (#879).
    let handle: FileSystemFileHandle | null = null;
    const picker = window as unknown as { showSaveFilePicker?: (options: object) => Promise<FileSystemFileHandle> };
    if (typeof picker.showSaveFilePicker === 'function') {
      try {
        handle = await picker.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Heirloom backup', accept: { 'application/octet-stream': ['.hlbak'] } }],
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return null;
        // Any other refusal (no gesture, a sandboxed frame): fall back to a download.
      }
    }
    setBackupBusy(true);
    try {
      const blob = await dumpDatabaseLogical();
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        // A plain download can't report a cancelled save dialog, so this path
        // still records the backup on click.
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoking at once can cancel the download before the browser reads it.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      // The status line reads this (via notifyBackup); the section no longer
      // repeats "Last backup" itself (#710).
      localStorage.setItem(FILE_BACKUP_KEY, new Date().toISOString());
      notifyBackup();
      return handle?.name ?? filename;
    } catch {
      setBackupError(t('backup_failed'));
      return null;
    } finally {
      setBackupBusy(false);
    }
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';
    setRestoreError(null);
    setRestoreStatus('reading');
    try {
      // Read-only: a bad file is rejected here, before anything is replaced.
      const { datadir, totals } = await inspectBackupLogical(new Blob([await file.arrayBuffer()]));
      const current = await getDatabaseTotals().catch(() => null);
      setPending({ file, datadir, backup: totals, current });
      setRestoreStatus('confirming');
    } catch (err) {
      setRestoreError(t(restoreErrorKey(err)));
      setRestoreStatus('idle');
    }
  }

  async function confirmRestore() {
    if (!pending) return;
    const { file, datadir } = pending;
    setRestoreStatus('restoring');
    try {
      await loadDatabase(datadir);
      // Record that a backup exists as of the restored file's date — markers live
      // in localStorage, not the DB dump, so a restore into a fresh browser would
      // otherwise show "no backup yet" and fire the stale-backup nudge.
      localStorage.setItem(FILE_BACKUP_KEY, new Date(file.lastModified).toISOString());
      notifyBackup();
      setRestoreStatus('idle');
      alert(t('restore_success'));
      window.location.reload();
    } catch (err) {
      setRestoreError(t(restoreErrorKey(err)));
      setRestoreStatus('idle');
    } finally {
      setPending(null);
    }
  }

  function cancelRestore() {
    setRestoreStatus('idle');
    setPending(null);
  }

  return {
    isPersistent, persistDenied, requestPersist,
    backup, backupBusy, backupError,
    fileInputRef, chooseFile: () => fileInputRef.current?.click(), onFileChange,
    restoreStatus, pending, restoreError, confirmRestore, cancelRestore,
  };
}
