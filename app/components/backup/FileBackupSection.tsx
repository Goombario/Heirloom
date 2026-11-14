'use client';

import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import RestoreProgress from './RestoreProgress';
import RestoreTotalsTable from './RestoreTotalsTable';
import { useFileBackup } from './useFileBackup';
import { Button } from '@/app/components/ui';
import { AlertTriangle, CircleHelp, Lock } from '@/lib/icons';
import { useIsDesktopApp } from '@/app/hooks/useIsDesktopApp';

/**
 * "This device" backup section: download a full snapshot file, restore from a
 * file, and manage storage persistence. Bare `<section>` (no Card/Modal wrapper)
 * so it composes inside both the Options card and the BackupModal.
 */
export default function FileBackupSection() {
  const t = useTranslations('options');
  const desktop = useIsDesktopApp();
  const {
    isPersistent, persistDenied, requestPersist: handleRequestPersist,
    backup, backupBusy, backupError,
    fileInputRef, chooseFile, onFileChange: handleFileChange,
    restoreStatus, pending, restoreError, confirmRestore: handleRestoreConfirm, cancelRestore,
  } = useFileBackup();

  return (
    <section aria-label={t('backup_section_this_device')}>
      <h3 className="text-base font-semibold text-text mb-1">{t('backup_section_this_device')}</h3>
      <p className="text-sm text-text-muted mb-3">{t('backup_desc')}</p>

      <div className="flex flex-wrap gap-3 mb-3">
        <Button variant="primary" onClick={() => { void backup(); }} disabled={backupBusy}>
          {backupBusy ? t('backup_saving') : t('backup_button')}
        </Button>
      </div>
      {backupError && <p className="text-sm text-error mb-3" role="alert">{backupError}</p>}

      {/* Restore is its own step with its own heading, so "replaces everything"
          is read before the file picker opens, not only in the confirm (#941). */}
      <div className="border-t border-border pt-3 mb-3">
        <h4 className="text-sm font-semibold text-text mb-1">{t('restore_title')}</h4>
        <p className="text-sm text-text-muted mb-3">{t(desktop ? 'restore_desc_desktop' : 'restore_desc')}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".hlbak"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          variant="outline"
          onClick={chooseFile}
          disabled={restoreStatus === 'reading' || restoreStatus === 'restoring'}
          aria-busy={restoreStatus === 'reading'}
        >
          {restoreStatus === 'reading' ? t('restore_reading') : t('restore_button')}
        </Button>
      </div>

      {restoreError && <p className="text-sm text-error mb-3" role="alert">{restoreError}</p>}

      {/* Storage persistence. The desktop app's storage is not a website's, so it
          is never evicted and there is nothing to request (#61). */}
      {desktop ? null : isPersistent === false ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg p-3 bg-warning-bg border border-warning-text/30">
          <AlertTriangle className="w-[18px] h-[18px] shrink-0 mt-px text-warning-text" aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <p className="text-warning-text leading-relaxed">{t('storage_not_persistent')}</p>
            {persistDenied && (
              <p className="text-xs text-warning-text/90 mt-1 leading-relaxed">{t('storage_request_denied')}</p>
            )}
            <Button variant="outline" size="sm" className="mt-2.5" onClick={handleRequestPersist}>
              {t('storage_request')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          {isPersistent === true
            ? <Lock className="w-4 h-4 shrink-0 text-success" aria-hidden="true" />
            : <CircleHelp className="w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />}
          <span className="text-text-secondary">
            {isPersistent === true ? t('storage_persistent') : t('storage_unknown')}
          </span>
        </div>
      )}

      <ConfirmDialog
        open={restoreStatus === 'confirming' && pending != null}
        variant="calm"
        tone="danger"
        title={t('restore_confirm_title')}
        body={
          <>
            <p className="text-sm text-text-muted mb-1">{t(desktop ? 'restore_confirm_body_desktop' : 'restore_confirm_body')}</p>
            {pending && (
              <>
                <p className="text-sm font-medium text-text">{pending.file.name}</p>
                <RestoreTotalsTable current={pending.current} backup={pending.backup} backupDate={new Date(pending.file.lastModified)} />
              </>
            )}
          </>
        }
        confirmLabel={t('restore_confirm')}
        cancelLabel={t('restore_cancel')}
        onConfirm={handleRestoreConfirm}
        onCancel={cancelRestore}
      />
      <RestoreProgress phase={restoreStatus === 'reading' || restoreStatus === 'restoring' ? restoreStatus : null} />
    </section>
  );
}
