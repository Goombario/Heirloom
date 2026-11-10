'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { MediaExportPreflight, MediaOmissionReason } from '@/lib/data/types';
import Modal from '@/app/components/Modal';
import { Button, DialogActions, DialogHeader } from '@/app/components/ui';

const REASONS: MediaOmissionReason[] = [
  'pending',
  'missing',
  'failed',
  'backing_missing',
  'legacy_materialization_unknown',
];

export interface MediaExportPreflightDialogProps {
  preflight: MediaExportPreflight;
  onReview: () => void;
  onCancel: () => void;
  onExportWithoutUnresolved: () => void;
  busy?: boolean;
}

/**
 * Aggregate-only warning shown when a media archive is not complete enough to
 * export safely. It intentionally receives no media records, paths, IDs, or
 * errors, so the dialog cannot disclose them accidentally.
 */
export default function MediaExportPreflightDialog({
  preflight,
  onReview,
  onCancel,
  onExportWithoutUnresolved,
  busy = false,
}: MediaExportPreflightDialogProps) {
  const t = useTranslations('importExport');
  const titleId = useId();
  const descriptionId = useId();
  const categories = REASONS.filter((reason) => preflight.byReason[reason] > 0);
  // A missing backing file has no import item, so the recovery panel can't show
  // it; Review opens Library photos instead, where it shows as a photo that
  // can't load and can be opened and deleted (#947).
  const libraryOnly = preflight.omittedTotal > 0 && preflight.byReason.backing_missing === preflight.omittedTotal;

  return (
    <Modal open onClose={onCancel} size="md" disableClose={busy} labelledBy={titleId} describedBy={descriptionId}>
      <div className="bg-card rounded-2xl shadow-xl overflow-hidden">
        <DialogHeader
          title={t('media_export_blocked_title')}
          titleId={titleId}
          onClose={onCancel}
          closeDisabled={busy}
          className="p-5 border-b border-border"
        />
        <div id={descriptionId} className="p-5">
          <p className="text-sm text-text-secondary leading-relaxed">
            {t('media_export_blocked_description')}
          </p>
          <p className="mt-4 text-sm font-semibold text-text">
            {t('media_export_blocked_total', { count: preflight.omittedTotal })}
          </p>
          {categories.length > 0 && (
            <ul className="mt-3 space-y-2" aria-label={t('media_export_categories')}>
              {categories.map((reason) => (
                <li key={reason} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-text-secondary">{t(`media_export_reason_${reason}`)}</span>
                    <span className="tabular-nums text-text" aria-label={t('media_export_category_count', { count: preflight.byReason[reason] })}>
                      {preflight.byReason[reason]}
                    </span>
                  </div>
                  {reason === 'backing_missing' && (
                    <p className="mt-1 text-meta text-text-muted">{t('media_export_backing_missing_hint')}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogActions justify="between" className="flex-wrap">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('media_export_cancel')}
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onReview} disabled={busy}>
              {t(libraryOnly ? 'media_export_review_library' : 'media_export_review')}
            </Button>
            <Button variant="primary" onClick={onExportWithoutUnresolved} disabled={busy}>
              {busy ? t('media_export_exporting') : t('media_export_override')}
            </Button>
          </div>
        </DialogActions>
      </div>
    </Modal>
  );
}
