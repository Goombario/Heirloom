'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import BackupPanel from '@/app/components/backup/BackupPanel';
import { Cloud, X } from '@/lib/icons';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { MobileBackupSheet } from './MobileBackupSheet';

/**
 * Shared backup modal — opened by the desktop status chip, the overdue nudge,
 * and the phone drawer's Backup row. A centred dialog on desktop; on a phone, the
 * Backup sheet (#1130). Scrolls internally for tall content.
 */
export default function BackupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('options');
  const tc = useTranslations('common');
  const titleId = useId();
  const isMobile = useIsMobile();

  if (isMobile) return <MobileBackupSheet open={open} onClose={onClose} />;

  return (
    <Modal open={open} onClose={onClose} size="md" labelledBy={titleId} elevated>
      <div className="bg-card rounded-2xl shadow-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-text-muted" aria-hidden="true" />
            <h2 id={titleId} className="text-lg font-bold text-text">{t('backup_modal_title')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc('close')}
            title={tc('close')}
            className="p-1.5 rounded-lg text-text-muted hover:bg-[color:var(--color-hover-surface)] hover:text-text transition-colors focus-ring"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5">
          <BackupPanel />
        </div>
      </div>
    </Modal>
  );
}
