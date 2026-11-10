'use client';

import { useTranslations } from 'next-intl';
import { DATA_MODE } from '@/lib/data';
import BackupPanel from '@/app/components/backup/BackupPanel';
import { Card } from '@/app/components/ui';

/**
 * Options "Local Data" card — hosts the shared BackupPanel (status + Drive +
 * file backup/restore + storage persistence). Only rendered when
 * NEXT_PUBLIC_DATA_MODE=local; does nothing for the hosted build.
 */
export default function LocalDataSection() {
  const t = useTranslations('options');
  if (DATA_MODE !== 'local') return null;

  return (
    <Card id="local-data" pad={false} className="p-6">
      <h2 className="section text-text mb-1">{t('local_data_title')}</h2>
      <p className="text-text-muted text-sm mb-4">{t('local_data_desc')}</p>
      <BackupPanel />
    </Card>
  );
}
