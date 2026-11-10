'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DATA_MODE } from '@/lib/data';
import { useBackupOverdue } from '@/app/components/backup/useBackupStatus';
import BackupModal from '@/app/components/backup/BackupModal';
import { Cloud } from '@/lib/icons';

/**
 * Desktop top-bar chip showing backup freshness and opening the BackupModal.
 * Local-first only (returns null in the hosted build); hidden on mobile by the
 * parent (the mobile navbar owns that surface). Colorblind-safe: the label text
 * changes with status, not just the color.
 */
export default function BackupStatusChip() {
  const t = useTranslations('options');
  const [open, setOpen] = useState(false);
  const { overdue } = useBackupOverdue();

  if (DATA_MODE !== 'local') return null;

  // Neutral until there's data to lose (#938).
  const warn = overdue === true;
  const label = warn ? t('chip_backup_now') : t('chip_backed_up');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // The name starts with the visible text (WCAG 2.5.3, BK-1); below xl the
        // text is hidden and the name still says what the chip does.
        aria-label={t('chip_aria', { status: label })}
        title={label}
        // Chrome, not a second coloured fill (#693 / #719): the warn state is a
        // small warning dot on the usual nav chip; the label and title say why.
        className="relative h-9 w-9 xl:w-auto xl:px-3 flex items-center justify-center gap-2 rounded-lg text-sm transition-colors text-white/90 bg-white/10 hover:bg-white/20 focus-ring"
      >
        <Cloud className="w-[18px] h-[18px]" aria-hidden="true" />
        {warn && (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 xl:static w-2 h-2 rounded-full bg-nav-warning ring-2 ring-[color:var(--color-nav-bg)] xl:ring-0"
          />
        )}
        <span className="hidden xl:inline">{label}</span>
      </button>
      <BackupModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
