'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/app/components/ui';
import { Plus } from '@/lib/icons';

/**
 * The picked repository, named above the Sources table (#1154): no box, just its
 * name, address and source count, with Edit and Add a source here. The table drops its
 * Repository column while this shows.
 */
export default function RepositoryHeader({
  name,
  address,
  count,
  canEdit,
  onEdit,
  onAddSource,
}: {
  name: string;
  address: string | null;
  count: number;
  canEdit: boolean;
  onEdit: () => void;
  onAddSource: () => void;
}) {
  const t = useTranslations('library');
  const line = [address?.trim(), t('source_count', { count })].filter(Boolean).join(' · ');
  return (
    <div data-testid="library-repository-header" className="mb-1 flex flex-wrap items-start justify-between gap-4 pb-4">
      <div className="min-w-0">
        <div className="eyebrow">{t('filter_repository')}</div>
        <h2 className="title-dialog mt-0.5">{name}</h2>
        <div className="mt-0.5 text-sm text-text-muted">{line}</div>
      </div>
      {canEdit && (
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>{t('repo_edit')}</Button>
          <Button variant="outline" size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={onAddSource}>
            {t('add_source_here')}
          </Button>
        </div>
      )}
    </div>
  );
}
