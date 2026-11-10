'use client';

import { useTranslations } from 'next-intl';
import { DRIVE_ENABLED } from '@/lib/data/drive/config';
import DriveBackupSection from '@/app/components/DriveBackupSection';
import FileBackupSection from '@/app/components/backup/FileBackupSection';
import { useBackupStatus } from '@/app/components/backup/useBackupStatus';
import { AlertTriangle, CheckCircle2 } from '@/lib/icons';
import { cx } from '@/app/components/ui';
import { useTimestamp } from '@/app/hooks/useTimestamp';

/**
 * The shared backup panel body: status banner + Google Drive section (when
 * enabled) + this-device (file) section. No Card/Modal wrapper — the parent
 * provides the container (Options card, or BackupModal). Single source of truth
 * so Options and the modal never drift.
 */
export default function BackupPanel() {
  const t = useTranslations('options');
  const { timestamp } = useTimestamp();
  const { lastBackup, level } = useBackupStatus();
  const warn = level === 'stale' || level === 'never';

  return (
    <div className="flex flex-col gap-5">
      <div
        className={cx(
          'rounded-lg p-3 flex items-start gap-2.5',
          warn ? 'bg-warning-bg border border-warning-text/30' : 'bg-surface-2',
        )}
        role={warn ? 'alert' : undefined}
      >
        {warn ? (
          <AlertTriangle className="w-4.5 h-4.5 text-warning-text shrink-0 mt-px" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="w-4.5 h-4.5 text-success shrink-0 mt-px" aria-hidden="true" />
        )}
        <div>
          <p className={cx('text-sm font-medium', warn ? 'text-warning-text' : 'text-text')}>
            {lastBackup ? t('backup_last', { date: timestamp(lastBackup) }) : t('backup_status_none')}
          </p>
          {warn && <p className="text-xs text-warning-text/90 mt-0.5">{t('backup_status_warn')}</p>}
        </div>
      </div>

      {DRIVE_ENABLED && (
        <>
          <DriveBackupSection />
          <hr className="border-border" />
        </>
      )}

      <FileBackupSection />
    </div>
  );
}
