'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { DATA_MODE } from '@/lib/data';
import { useBackupOverdue } from '@/app/components/backup/useBackupStatus';
import BackupModal from '@/app/components/backup/BackupModal';
import { Button } from '@/app/components/ui';
import { AlertTriangle } from '@/lib/icons';
import { useIsMobile } from '@/app/hooks/useIsMobile';

const SNOOZE_KEY = 'heirloom_backup_nudge_snoozed_until';
const SNOOZE_DAYS = 7;

/**
 * App-level banner shown only when a backup is overdue (`stale`/`never`), there's
 * data to lose (#938), and the nudge is not snoozed. Dismiss snoozes it for a
 * week so it doesn't nag every load. Local-first only. `useBackupOverdue` is
 * `null` until its data check has run, and the banner renders nothing until
 * then, so it never flashes on first paint.
 *
 * The layout mounts it twice: `app` above the page for desktop, and `page` through
 * `PageShell`, under a phone page's header (#1130). Each renders only on its own screen.
 */
export default function BackupNudge({ placement = 'app' }: { placement?: 'app' | 'page' }) {
  const t = useTranslations('options');
  const tm = useTranslations('mobileBackup');
  const { overdue, ageDays } = useBackupOverdue();
  const isMobile = useIsMobile();
  const [snoozed, setSnoozed] = useState<boolean | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (DATA_MODE !== 'local') return;
    const read = () => setSnoozed(Date.now() < Number(localStorage.getItem(SNOOZE_KEY) ?? 0));
    read();
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, []);

  function dismiss() {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
    setSnoozed(true);
  }

  const show = overdue === true && snoozed === false;
  if (DATA_MODE !== 'local' || isMobile !== (placement === 'page')) return null;
  // Backing up from the sheet clears the reminder; the sheet stays until it is closed.
  if (!show) return modalOpen ? <BackupModal open onClose={() => setModalOpen(false)} /> : null;

  if (isMobile) {
    // The phone reminder (#1130): an orange row with an edge at the top of the page
    // content, scrolling with it, and two text links.
    return (
      <>
        <div role="alert" className="relative bg-warning-bg pl-[19px] pr-4 pt-3 pb-1 text-sm leading-snug text-text before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-[3px] before:bg-warning-edge">
          <b className="block font-semibold text-warning-text">
            {ageDays == null ? tm('nudge_never') : tm('nudge_weeks', { count: Math.max(2, Math.floor(ageDays / 7)) })}
          </b>
          <span className="block">{tm('nudge_body')}</span>
          <span className="flex gap-[18px]">
            <button type="button" onClick={() => setModalOpen(true)} className="min-h-11 font-semibold text-text cursor-pointer focus-ring">
              {t('chip_backup_now')}
            </button>
            <button type="button" onClick={dismiss} className="min-h-11 font-medium text-text-muted cursor-pointer focus-ring">
              {tm('not_now')}
            </button>
          </span>
        </div>
        <BackupModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  return (
    <>
      <div role="alert" className="bg-warning-bg border-b border-warning-text/30 px-4 py-2.5">
        <div className="container mx-auto flex items-center gap-3 flex-wrap">
          <AlertTriangle className="w-[18px] h-[18px] text-warning-text shrink-0" aria-hidden="true" />
          <span className="text-sm text-warning-text flex-1 min-w-[12rem]">{t('nudge_message')}</span>
          <div className="flex items-center gap-2 shrink-0">
            {/* Outline: the page's own main action keeps the one colour fill (#693). */}
            <Button variant="outline" size="sm" onClick={() => setModalOpen(true)}>
              {t('chip_backup_now')}
            </Button>
            <button
              type="button"
              onClick={dismiss}
              className="text-sm font-medium text-warning-text px-2.5 py-1.5 rounded-lg hover:underline focus-ring"
            >
              {t('nudge_dismiss')}
            </button>
          </div>
        </div>
      </div>
      <BackupModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
