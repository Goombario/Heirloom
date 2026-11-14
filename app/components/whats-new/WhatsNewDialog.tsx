'use client';

import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import { Button, DialogHeader } from '@/app/components/ui';
import { itemText, type ChangelogEntry } from '@/lib/whats-new';

/**
 * The What's new list (#35): each release's user-facing changes, newest first.
 * The shared Modal gives it the focus trap, Esc and focus restore.
 */
export default function WhatsNewDialog({ open, onClose, entries }: {
  open: boolean;
  onClose: () => void;
  entries: readonly ChangelogEntry[];
}) {
  const t = useTranslations('whats_new');
  const locale = useLocale();
  const titleId = useId();

  return (
    <Modal open={open} onClose={onClose} size="form" labelledBy={titleId}>
      <div className="bg-card rounded-2xl shadow-xl p-6 flex flex-col gap-4 max-h-[85dvh]">
        <DialogHeader title={t('title')} titleId={titleId} onClose={onClose} />
        <div className="min-h-0 flex-1 overflow-auto scroll-area flex flex-col gap-5">
          {entries.length === 0 ? (
            <p className="m-0 text-sm text-text-secondary">{t('empty')}</p>
          ) : entries.map((entry) => (
            <section key={entry.version} className="flex flex-col gap-2">
              <h3 className="m-0 text-base font-semibold text-text">{t('version', { version: entry.version })}</h3>
              <ul className="m-0 pl-5 list-disc flex flex-col gap-1.5 text-sm text-text-secondary">
                {entry.items.map((item, i) => <li key={i}>{itemText(item, locale)}</li>)}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>{t('done')}</Button>
        </div>
      </div>
    </Modal>
  );
}
