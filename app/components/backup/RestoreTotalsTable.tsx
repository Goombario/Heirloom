'use client';

import { useTranslations } from 'next-intl';
import type { DatabaseTotals } from '@/lib/db/connection.pglite';
import { useTimestamp } from '@/app/hooks/useTimestamp';

interface RestoreTotalsTableProps {
  /** This browser's totals now; null when they couldn't be read. */
  current: DatabaseTotals | null;
  backup: DatabaseTotals;
  /** When the backup was made: the file's date, or Drive's modified time. */
  backupDate: Date | string;
}

/**
 * The restore confirmation's comparison (BK-1): what this browser holds beside
 * what the backup would replace it with. Shared by the file and Drive restores.
 */
export default function RestoreTotalsTable({ current, backup, backupDate }: RestoreTotalsTableProps) {
  const t = useTranslations('options');
  const { timestamp } = useTimestamp();
  const rows: Array<[keyof DatabaseTotals, string]> = [
    ['trees', t('restore_count_trees')],
    ['people', t('restore_count_people')],
    ['families', t('restore_count_families')],
    ['media', t('restore_count_media')],
  ];
  return (
    <table className="mt-3 w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-text-muted">
          <th scope="col" className="font-normal pb-1"><span className="sr-only">{t('restore_count_item')}</span></th>
          <th scope="col" className="font-normal pb-1 text-right">{t('restore_column_current')}</th>
          <th scope="col" className="font-normal pb-1 text-right">
            {t('restore_column_backup', { date: timestamp(backupDate) })}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, label]) => (
          <tr key={key} className="border-t border-border">
            <th scope="row" className="py-1 text-left font-normal text-text-secondary">{label}</th>
            <td className="py-1 text-right tabular-nums text-text">{current ? current[key].toLocaleString() : '—'}</td>
            <td className="py-1 text-right tabular-nums font-medium text-text">{backup[key].toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
