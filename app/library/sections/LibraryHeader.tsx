'use client';

import { useTranslations } from 'next-intl';
import { CoverBand } from '@/app/components/ui';
import { useActiveTreeName } from '@/app/hooks/useActiveTreeName';

/**
 * Library page header (#59): the short navy band of the v1.1 list pages, with the
 * tree's name over the title and the evidence-shelf line under it.
 */
export default function LibraryHeader() {
  const t = useTranslations('library');
  const treeName = useActiveTreeName();
  return (
    <div className="mb-4">
      <CoverBand variant="short" eyebrow={treeName} title={t('title')} meta={t('evidence_subtitle')} />
    </div>
  );
}
