'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/app/components/ui';
import { setGeocodingEnabled } from '@/lib/geocode/prefs';

/**
 * The one-time question before live place lookup sends anything (#791). Shown
 * where a lookup would first help, while the user hasn't answered. Either
 * answer is stored, so it never comes back; Options can change it later.
 */
export default function GeocodingPrompt({ onEnabled }: { onEnabled?: () => void }) {
  const t = useTranslations('geocodingPrompt');
  return (
    <div
      role="group"
      aria-label={t('title')}
      className="mt-2 rounded-md border border-border bg-card-alt p-3 text-sm"
    >
      <p className="font-medium text-text">{t('title')}</p>
      <p className="mt-1 text-text-secondary">{t('body')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => { setGeocodingEnabled(true); onEnabled?.(); }}>
          {t('turn_on')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setGeocodingEnabled(false)}>
          {t('keep_off')}
        </Button>
      </div>
    </div>
  );
}
