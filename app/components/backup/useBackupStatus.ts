'use client';

import { useEffect, useState } from 'react';
import { isDriveConnected } from '@/lib/data/drive/auth';
import { useLocalHasData } from '@/app/components/backup/useLocalHasData';
import {
  computeBackupStatus,
  type BackupStatus,
  FILE_BACKUP_KEY,
  DRIVE_BACKUP_KEY,
  BACKUP_EVENT,
} from '@/lib/data/backup-status';

export interface BackupStatusResult extends BackupStatus {
  driveConnected: boolean;
}

const INITIAL: BackupStatusResult = {
  lastBackup: null,
  ageDays: null,
  level: 'never',
  driveConnected: false,
};

/**
 * Live backup freshness for the local-first build. Reads the file/Drive backup
 * timestamps from localStorage and recomputes on:
 *  - mount,
 *  - cross-tab `storage` events,
 *  - the in-tab `heirloom:backup` event fired after a successful backup.
 *
 * SSR-safe: returns the "never" default until mounted (avoids hydration drift).
 */
export function useBackupStatus(): BackupStatusResult {
  const [status, setStatus] = useState<BackupStatusResult>(INITIAL);

  useEffect(() => {
    const read = () => {
      const file = localStorage.getItem(FILE_BACKUP_KEY);
      const drive = localStorage.getItem(DRIVE_BACKUP_KEY);
      setStatus({ ...computeBackupStatus(file, drive), driveConnected: isDriveConnected() });
    };
    read();

    window.addEventListener('storage', read);
    window.addEventListener(BACKUP_EVENT, read);
    return () => {
      window.removeEventListener('storage', read);
      window.removeEventListener(BACKUP_EVENT, read);
    };
  }, []);

  return status;
}

/**
 * The one rule for the backup warnings (the banner, the nav chip's dot and the
 * drawer, #938): the backup is stale or was never made, AND there's something in
 * this browser to lose. `null` until the data check has run, so a populated app
 * never flashes the banner and an empty one never shows it.
 */
export function useBackupOverdue(): BackupStatusResult & { overdue: boolean | null } {
  const status = useBackupStatus();
  const hasData = useLocalHasData();
  const stale = status.level === 'stale' || status.level === 'never';
  return { ...status, overdue: hasData == null ? null : stale && hasData };
}
