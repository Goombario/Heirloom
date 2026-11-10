'use client';

import { useTranslations } from 'next-intl';
import { Plus } from '@/lib/icons';
import { SOURCE_TYPES, sourceTypeLabel } from '@/app/library/sourceTypes';
import type { SourceShow } from '@/app/library/useSourceFilters';
import LibraryPanel, { LibraryPanelGroup, LibraryPanelLink, LibraryPanelRow } from './LibraryPanel';

export interface PanelRepository {
  id: number;
  name: string;
  count: number;
}

/**
 * The Sources tab's floating panel (#1154): Show (All sources or Uncited), Type and
 * Repository, which all combine, then Add repository and Manage repositories at its
 * foot. Picking the active row again clears that filter.
 */
export default function SourcesPanel({
  totalCount,
  uncitedCount,
  show,
  setShow,
  typeCounts,
  typeFilter,
  setTypeFilter,
  repositories,
  repoId,
  setRepoId,
  canEdit,
  onAddRepository,
  onManageRepositories,
}: {
  totalCount: number;
  uncitedCount: number;
  show: SourceShow;
  setShow: (show: SourceShow) => void;
  typeCounts: Map<string, number>;
  typeFilter: string | null;
  setTypeFilter: (type: string | null) => void;
  repositories: PanelRepository[];
  repoId: number | null;
  setRepoId: (id: number | null) => void;
  canEdit: boolean;
  onAddRepository: () => void;
  onManageRepositories: () => void;
}) {
  const t = useTranslations('library');
  // Known types in display order, then any custom type an import brought in.
  const types = [
    ...SOURCE_TYPES.filter((type) => (typeCounts.get(type) ?? 0) > 0 || typeFilter === type),
    ...[...typeCounts.keys()].filter((type) => !(SOURCE_TYPES as readonly string[]).includes(type)),
  ];

  return (
    <LibraryPanel label={t('filter_sources_title')} testId="library-sources-panel">
      <LibraryPanelGroup title={t('show_label')}>
        <LibraryPanelRow label={t('show_all_sources')} count={totalCount} active={show === 'all'} onClick={() => setShow('all')} />
        <LibraryPanelRow
          label={t('show_uncited')}
          count={uncitedCount}
          warn
          active={show === 'uncited'}
          onClick={() => setShow(show === 'uncited' ? 'all' : 'uncited')}
        />
      </LibraryPanelGroup>

      <LibraryPanelGroup title={t('filter_type')}>
        <LibraryPanelRow label={t('filter_all_types')} count={totalCount} active={typeFilter === null} onClick={() => setTypeFilter(null)} />
        {types.map((type) => (
          <LibraryPanelRow
            key={type}
            label={sourceTypeLabel(type, t)}
            count={typeCounts.get(type) ?? 0}
            active={typeFilter === type}
            onClick={() => setTypeFilter(type === typeFilter ? null : type)}
          />
        ))}
      </LibraryPanelGroup>

      {repositories.length > 0 && (
        <LibraryPanelGroup title={t('filter_repository')}>
          <LibraryPanelRow label={t('filter_all_repositories')} active={repoId === null} onClick={() => setRepoId(null)} />
          {repositories.map((repo) => (
            <LibraryPanelRow
              key={repo.id}
              label={repo.name}
              count={repo.count}
              active={repoId === repo.id}
              onClick={() => setRepoId(repo.id === repoId ? null : repo.id)}
            />
          ))}
        </LibraryPanelGroup>
      )}

      <div className="mt-2.5 flex flex-col gap-0.5 border-t border-border pt-2.5">
        {canEdit && (
          <LibraryPanelLink onClick={onAddRepository} icon={<Plus size={14} aria-hidden="true" />}>
            {t('repo_add')}
          </LibraryPanelLink>
        )}
        <LibraryPanelLink onClick={onManageRepositories}>{t('manage_repositories')}</LibraryPanelLink>
      </div>
    </LibraryPanel>
  );
}
