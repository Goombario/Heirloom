'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Banner } from '@/app/components/ui';
import { AlertTriangle, Check, Loader2, X } from '@/lib/icons';
import { dismissBackgroundMedia, useBackgroundMedia } from './backgroundMedia';

/** How long "Media added" stays before it clears itself. */
const FINISHED_MS = 5000;

/**
 * The progress of media still being added after its dialog closed (#62), in the
 * corner of every page, so the reader can keep working. A stop stays until it
 * is dismissed; a finished batch clears itself.
 */
export function BackgroundMediaStatus() {
  const t = useTranslations('upload');
  const { running, done, total, failure, finished } = useBackgroundMedia();

  useEffect(() => {
    if (finished == null) return;
    const timer = window.setTimeout(dismissBackgroundMedia, FINISHED_MS);
    return () => window.clearTimeout(timer);
  }, [finished]);

  if (!running && failure == null && finished == null) return null;

  const dismiss = !running && (
    <button type="button" onClick={dismissBackgroundMedia} aria-label={t('background_dismiss')} title={t('background_dismiss')}
      className="-my-1 -mr-1.5 ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-current hover:bg-hover-surface focus-ring">
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  return (
    <div className="fixed bottom-4 left-4 z-60 max-w-[min(26rem,calc(100vw-2rem))] shadow-card">
      {failure ? (
        <Banner tone="warning" align="center" icon={<AlertTriangle className="h-4 w-4" />}>
          <span className="flex-1">{t('background_stopped', { done: failure.done, total: failure.total, message: failure.message })}</span>
          {dismiss}
        </Banner>
      ) : running ? (
        <Banner tone="info" align="center" icon={<Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}>
          <span className="flex-1 tabular-nums">{t('background_adding', { done, total })}</span>
        </Banner>
      ) : (
        <Banner tone="success" align="center" icon={<Check className="h-4 w-4" />}>
          <span className="flex-1">{t('background_added', { count: finished ?? 0 })}</span>
          {dismiss}
        </Banner>
      )}
    </div>
  );
}
