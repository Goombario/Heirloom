'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import { Card } from '@/app/components/ui';
import { Loader2 } from '@/lib/icons';

/**
 * The "this may take a while" state for a restore (#282). A large backup used to
 * show only a busy button while it was read and then loaded, which felt like a
 * hang. `reading` covers the download (Drive) and the read-only check before the
 * confirm; `restoring` covers `loadDatabase` until the page reloads. It can't be
 * dismissed: neither step can be called back once it runs. Reading waits a
 * moment before showing, so a small backup doesn't flash it; restoring shows at
 * once, since it takes the confirm dialog's place and always ends in a reload.
 */
const SHOW_AFTER_MS = 400;

export default function RestoreProgress({ phase }: { phase: 'reading' | 'restoring' | null }) {
  const t = useTranslations('options');
  const titleId = useId();
  const bodyId = useId();
  const [shownPhase, setShownPhase] = useState<typeof phase>(null);
  useEffect(() => {
    if (!phase) return;
    const timer = setTimeout(() => setShownPhase(phase), phase === 'reading' ? SHOW_AFTER_MS : 0);
    // A later restore, or the next step, waits its own moment again.
    return () => { clearTimeout(timer); setShownPhase(null); };
  }, [phase]);
  if (!phase || shownPhase !== phase) return null;
  return (
    <Modal open onClose={() => {}} disableClose size="sm" elevated labelledBy={titleId} describedBy={bodyId}>
      <Card className="shadow-lg flex gap-3 items-start" role="status" aria-live="polite">
        <Loader2 className="w-5 h-5 shrink-0 mt-0.5 text-text-muted animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-text m-0 mb-1">
            {t(phase === 'reading' ? 'restore_progress_reading_title' : 'restore_progress_title')}
          </h2>
          <p id={bodyId} className="text-sm text-text-muted m-0">
            {t(phase === 'reading' ? 'restore_progress_reading_body' : 'restore_progress_body')}
          </p>
        </div>
      </Card>
    </Modal>
  );
}
