'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card } from '@/app/components/ui';
import { formatMediaBytes } from '@/lib/media/format-bytes';
import type { OrphanMediaCheck } from '@/lib/services/orphan-media-check';

/**
 * The daily orphan media dry run (#946), above the admin log. It only reports:
 * removing the files stays a manual step after the dry run is reviewed (#888).
 */
export function OrphanMediaNotice({ check, failed }: { check: OrphanMediaCheck | null; failed: boolean }) {
  const t = useTranslations('members');
  const locale = useLocale();
  if (!check) {
    return failed ? <p className="m-0 mb-3 max-md:px-4 text-sm text-text-muted">{t('orphans_failed')}</p> : null;
  }
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(check.checkedAt));
  return (
    <Card className="mb-3 max-md:mx-4">
      <h2 className="m-0 text-sm font-semibold text-text">{t('orphans_label')}</h2>
      <p className="m-0 mt-1 text-sm text-text-secondary">
        {check.files === 0
          ? t('orphans_none', { when })
          : t('orphans_found', { count: check.files, size: formatMediaBytes(check.bytes, locale), when })}
      </p>
      {check.files > 0 && <p className="m-0 mt-1 text-meta text-text-muted">{t('orphans_hint')}</p>}
    </Card>
  );
}
