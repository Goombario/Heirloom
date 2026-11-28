'use client';

import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import RestoreProgress from './RestoreProgress';
import RestoreTotalsTable from './RestoreTotalsTable';
import { useFileBackup } from './useFileBackup';
import { Button } from '@/app/components/ui';
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
    persistState, persistDenied, requestPersist: handleRequestPersist,
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
          accept=".hlbak,.tar"
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
      {desktop || persistState == null ? null : (
        // Three honest states (#18): kept, not kept (Ask again), or the browser can't say.
        <div className="border-t border-border pt-3" role={persistState === 'not_kept' ? 'alert' : undefined}>
          <h4 className="text-sm font-semibold text-text mb-2">{t('storage_heading')}</h4>
          <div className="flex items-start gap-2.5">
            <span aria-hidden="true" className={persistState === 'kept'
              ? 'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-success'
              : persistState === 'not_kept'
                ? 'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-warning-edge'
                : 'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-text-muted'} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-text">{t(`storage_state_${persistState}`)}</p>
              <p className="text-text-muted leading-relaxed">{t(`storage_state_${persistState}_sub`)}</p>
              {persistState === 'not_kept' && persistDenied && (
                <p className="text-xs text-text-muted mt-1 leading-relaxed">{t('storage_request_denied')}</p>
              )}
            </div>
            {persistState === 'not_kept' && (
              <Button variant="outline" size="sm" onClick={handleRequestPersist}>{t('storage_ask_again')}</Button>
            )}
          </div>
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
