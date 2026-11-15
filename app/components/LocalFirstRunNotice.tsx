'use client';

import { useState, useEffect, useId } from 'react';
import { useTranslations } from 'next-intl';
import { DATA_MODE } from '@/lib/data';
import { isDesktopApp } from '@/lib/desktop';
import Modal from '@/app/components/Modal';
import { Button, Card } from '@/app/components/ui';
import { Check, Loader2 } from '@/lib/icons';
import { useDatabaseSetup } from '@/app/components/useDatabaseSetup';

const SEEN_KEY = 'heirloom_local_first_run_seen';

/**
 * Modal shown once on first visit in local (static) mode in a browser.
 * Explains data locality, requests persistent storage, then stores a flag
 * so it never appears again on this device/browser. The desktop app skips it
 * (#61): its storage is not a website's, and the home page's first-run Import
 * already says where to start.
 */
export default function LocalFirstRunNotice() {
  const t = useTranslations('options');
  // Start hidden so the server prerender and the first client render BOTH produce null —
  // matching markup is required for hydration. Reading localStorage in the initializer
  // instead made the client's first render emit the modal while the server emitted
  // nothing: a structural hydration mismatch (React #418). Reveal after mount instead,
  // mirroring the mounted-guard pattern in ThemeProvider/LanguageProvider.
  const [visible, setVisible] = useState(false);
  const titleId = useId();
  const bodyId = useId();
  // A first visit creates the database while this notice is up; say so, so the
  // page behind it doesn't look stuck.
  const setup = useDatabaseSetup();

  useEffect(() => {
    if (DATA_MODE !== 'local' || isDesktopApp()) return;
    if (localStorage.getItem(SEEN_KEY)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true);
    // Request persistent storage when the first-run notice is shown.
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {/* silently swallow denial */});
    }
  }, []);

  function handleDismiss() {
    localStorage.setItem(SEEN_KEY, '1');
    setVisible(false);
  }

  // The shared Modal gives it dialog semantics, a focus trap, Esc and focus
  // restore; it used to be a bare z-9999 overlay with none of them (#731).
  // Dismissing by Esc or the backdrop counts as seen: the notice is informational.
  return (
    <Modal open={visible} onClose={handleDismiss} labelledBy={titleId} describedBy={bodyId}>
      <Card pad={false} className="shadow-xl p-6">
        <h2 id={titleId} className="title-dialog mb-3">{t('first_run_title')}</h2>
        <p id={bodyId} className="text-sm text-text-secondary mb-3">{t('first_run_body')}</p>
        <p className={setup ? 'text-sm text-text-muted mb-3' : 'text-sm text-text-muted mb-5'}>{t('first_run_persist')}</p>
        {setup && (
          <p role="status" className="text-sm text-text-secondary mb-5 flex items-center gap-2">
            {setup === 'setting-up'
              ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" aria-hidden="true" />
              : <Check className="w-4 h-4 shrink-0 text-success" aria-hidden="true" />}
            {setup === 'setting-up' ? t('first_run_setting_up') : t('first_run_set_up')}
          </p>
        )}
        <Button variant="primary" className="w-full" onClick={handleDismiss}>
          {t('first_run_ok')}
        </Button>
      </Card>
    </Modal>
  );
}
