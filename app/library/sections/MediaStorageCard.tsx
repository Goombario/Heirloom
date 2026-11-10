'use client';

import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ArrowUpRight, RotateCcw } from '@/lib/icons';
import { Button } from '@/app/components/ui';
import { formatMediaBytes } from '@/lib/media/format-bytes';
import type { MediaStorageSummary } from '@/lib/data/types';

export interface MediaStorageCardProps {
  summary: MediaStorageSummary | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onReviewLargest: () => void;
}

type StorageTone = 'neutral' | 'near' | 'almost' | 'full';

function storageTone(percentUsed: number): StorageTone {
  if (percentUsed >= 100) return 'full';
  if (percentUsed >= 90) return 'almost';
  if (percentUsed >= 80) return 'near';
  return 'neutral';
}

// The summary is the filter rail's footer, not a card of its own (#780, LY-5):
// no chrome at rest. A tinted box appears only as a warning state.
function toneClasses(tone: StorageTone) {
  switch (tone) {
    case 'full': return 'rounded-lg border p-3 border-error bg-[color:var(--error-bg)]';
    case 'almost': return 'rounded-lg border p-3 border-warning bg-[color:var(--warning-bg)]';
    case 'near': return 'rounded-lg border p-3 border-[color:var(--warning-text)] bg-[color:var(--warning-bg)]';
    default: return '';
  }
}

export default function MediaStorageCard({
  summary,
  loading,
  error,
  onRetry,
  onReviewLargest,
}: MediaStorageCardProps) {
  const t = useTranslations('library');
  const locale = useLocale();

  if (loading && summary === null) {
    return (
      <section
        data-testid="library-storage-card"
        aria-busy="true"
        className="min-h-[120px]"
      >
        <div className="eyebrow mb-2">{t('photo_storage_title')}</div>
        <div className="h-5 w-3/4 animate-pulse rounded bg-surface-2" />
        <div className="mt-3 h-2 w-full animate-pulse rounded-full bg-surface-2" />
        <div className="mt-3 h-3 w-1/2 animate-pulse rounded bg-surface-2" />
      </section>
    );
  }

  if (error !== null) {
    return (
      <section data-testid="library-storage-card" className="rounded-lg border border-error bg-[color:var(--error-bg)] p-3">
        <div className="flex items-start gap-2 text-error">
          <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold">{t('photo_storage_error')}</div>
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw size={13} aria-hidden="true" />}
              onClick={onRetry}
              className="mt-2 min-h-9 px-0 text-error hover:bg-transparent hover:underline"
            >
              {t('photo_storage_retry')}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  if (summary === null) return null;

  if (summary.quotaMode === 'device' || summary.limitBytes === null || summary.percentUsed === null) {
    return (
      <section data-testid="library-storage-card">
        <div className="eyebrow mb-2">{t('photo_storage_title')}</div>
        <div className="serif text-lg font-semibold text-text">
          {formatMediaBytes(summary.usedBytes, locale)}
        </div>
        <div className="mt-1 text-xs leading-4 text-text-muted">{t('photo_storage_device')}</div>
        <Button
          variant="ghost"
          size="sm"
          iconRight={<ArrowUpRight size={13} aria-hidden="true" />}
          onClick={onReviewLargest}
          className="mt-2 min-h-9 px-0 text-link hover:bg-transparent hover:underline"
        >
          {t('photo_storage_review_largest')}
        </Button>
      </section>
    );
  }

  const percentUsed = Math.max(0, summary.percentUsed);
  const tone = storageTone(percentUsed);
  const progressWidth = Math.min(100, percentUsed);
  const statusLabel = t({
    near: 'photo_storage_near_limit',
    almost: 'photo_storage_almost_full',
    full: 'photo_storage_full',
    neutral: 'photo_storage_available',
  }[tone]);
  const statusIsWarning = tone !== 'neutral';
  const remainingBytes = Math.max(0, summary.remainingBytes ?? summary.limitBytes - summary.usedBytes);

  return (
    <section
      data-testid="library-storage-card"
      className={toneClasses(tone) || undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="eyebrow">{t('photo_storage_this_tree')}</div>
          <h2 className="mt-1 text-sm font-semibold text-text">{t('photo_storage_title')}</h2>
        </div>
        <strong className="tabular-nums text-xl font-semibold leading-none text-text" aria-label={t('photo_storage_percent', { percent: Math.round(percentUsed) })}>
          {Math.round(percentUsed)}%
        </strong>
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <strong className="serif text-lg font-semibold text-text">{formatMediaBytes(summary.usedBytes, locale)}</strong>
        <span className="text-xs text-text-muted">{t('photo_storage_of_limit', { limit: formatMediaBytes(summary.limitBytes, locale) })}</span>
      </div>

      <div
        role="progressbar"
        aria-label={t('photo_storage_progress_label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(percentUsed))}
        className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={`h-full rounded-full ${tone === 'full' || tone === 'almost' ? 'bg-error' : tone === 'near' ? 'bg-warning-text' : 'bg-text-secondary'}`}
          style={{ width: `${progressWidth}%` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className={tone === 'full' ? 'font-semibold text-error' : statusIsWarning ? 'font-semibold text-warning-text' : 'text-text-muted'}>{statusLabel}</span>
        <span className="text-right text-text-muted">{t('photo_storage_left', { remaining: formatMediaBytes(remainingBytes, locale) })}</span>
      </div>

      <Button
        variant="ghost"
        size="sm"
        icon={statusIsWarning ? <AlertTriangle size={13} aria-hidden="true" /> : undefined}
        iconRight={<ArrowUpRight size={13} aria-hidden="true" />}
        onClick={onReviewLargest}
        className="mt-2 min-h-9 px-0 text-link hover:bg-transparent hover:underline"
      >
        {t('photo_storage_review_largest')}
      </Button>
    </section>
  );
}
