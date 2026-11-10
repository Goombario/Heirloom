'use client';

import { useTranslations } from 'next-intl';

/**
 * Library page header — serif title and evidence-shelf subtitle.
 */
export default function LibraryHeader() {
  const t = useTranslations('library');
  return (
    <div className="row mb-3.5 gap-3" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <div>
        <h1 className="title serif">{t('title')}</h1>
        <p className="muted text-base mt-0.5 mx-0 mb-0">
          {t('evidence_subtitle')}
        </p>
      </div>
    </div>
  );
}
