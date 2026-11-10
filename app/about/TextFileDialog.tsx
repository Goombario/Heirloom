'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import { DialogHeader } from '@/app/components/ui';

/**
 * Shows a text file bundled with the app (the licence, third-party notices) in a
 * dialog. A plain link would leave the app, and in the desktop app a bundled
 * file has no system-browser address to open (#1256).
 */
export default function TextFileDialog({ open, onClose, title, href }: {
  open: boolean;
  onClose: () => void;
  title: string;
  href: string;
}) {
  const t = useTranslations('about');
  const titleId = useId();
  const [state, setState] = useState<{ href: string; text: string | null; failed: boolean } | null>(null);

  useEffect(() => {
    if (!open || state?.href === href) return;
    let cancelled = false;
    fetch(href)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => { if (!cancelled) setState({ href, text, failed: false }); })
      .catch(() => { if (!cancelled) setState({ href, text: null, failed: true }); });
    return () => { cancelled = true; };
  }, [open, href, state?.href]);

  const current = state?.href === href ? state : null;

  return (
    <Modal open={open} onClose={onClose} size="xl" labelledBy={titleId}>
      <div className="bg-card rounded-2xl shadow-xl p-6 flex flex-col gap-4 max-h-[85dvh]">
        <DialogHeader title={title} titleId={titleId} onClose={onClose} />
        {current?.failed ? (
          <p className="m-0 text-sm text-text-secondary">{t('file_error')}</p>
        ) : current?.text != null ? (
          <pre className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words text-meta leading-relaxed text-text-secondary">{current.text}</pre>
        ) : (
          <p className="m-0 text-sm text-text-muted" role="status">{t('file_loading')}</p>
        )}
      </div>
    </Modal>
  );
}
