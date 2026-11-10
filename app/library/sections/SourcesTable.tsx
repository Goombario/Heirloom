'use client';

import { useCallback, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AvatarStack, DataTable, type Column } from '@/app/components/ui';
import { compareText } from '@/lib/collation';
import { displayFullName } from '@/lib/utils/names';
import { SourceTypeIcon, sourceTypeLabel } from '@/app/library/sourceTypes';
import type { SourceWithCitationCount } from '@/lib/db/queries/sources';

type SortKey = 'title' | 'type' | 'repository' | 'citations';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

const SORT_KEYS: readonly string[] = ['title', 'type', 'repository', 'citations'];

/** The amber "Uncited" mark: no fact cites this source yet. */
function UncitedMark() {
  const t = useTranslations('library');
  return (
    <span className="inline-flex whitespace-nowrap rounded-full bg-evidence-bg px-[7px] py-px text-xs font-medium text-evidence">
      {t('uncited_mark')}
    </span>
  );
}

/**
 * The desktop Sources table (#1153): Title, Type, Repository, Cited by and Citations,
 * sorted by title to start with; every column but Cited by sorts. Type and Cited by
 * drop out below lg (tablet). A row opens the source; the title is the row's button.
 */
export default function SourcesTable({
  sources,
  treeId,
  onOpen,
  hideRepository = false,
  empty,
}: {
  sources: SourceWithCitationCount[];
  treeId: number | null;
  onOpen: (id: number) => void;
  /** A picked repository names itself above the table, so its column goes (#1154). */
  hideRepository?: boolean;
  empty?: React.ReactNode;
}) {
  const t = useTranslations('library');
  const locale = useLocale();
  const [sort, setSort] = useState<Sort>({ key: 'title', dir: 'asc' });

  const titleOf = useCallback((s: SourceWithCitationCount) => s.Title?.trim() || t('untitled_source'), [t]);
  const typeOf = useCallback((s: SourceWithCitationCount) => sourceTypeLabel(s.Type, t), [t]);

  const rows = useMemo(() => {
    const sign = sort.dir === 'asc' ? 1 : -1;
    const byTitle = (a: SourceWithCitationCount, b: SourceWithCitationCount) => compareText(titleOf(a), titleOf(b), locale);
    const primary = (a: SourceWithCitationCount, b: SourceWithCitationCount): number => {
      switch (sort.key) {
        case 'title': return sign * byTitle(a, b);
        case 'type': return sign * compareText(typeOf(a), typeOf(b), locale);
        case 'citations': return sign * (a.citationCount - b.citationCount);
        case 'repository':
          // Sources with no repository stay at the bottom whichever way the column sorts.
          if (!a.RepositoryName !== !b.RepositoryName) return a.RepositoryName ? -1 : 1;
          return sign * compareText(a.RepositoryName, b.RepositoryName, locale);
      }
    };
    return [...sources].sort((a, b) => primary(a, b) || byTitle(a, b) || a.Id - b.Id);
  }, [sources, sort, locale, titleOf, typeOf]);

  function handleSortChange(key: string) {
    if (!SORT_KEYS.includes(key)) return;
    const next = key as SortKey;
    setSort((prev) => (prev.key === next ? { key: next, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key: next, dir: 'asc' }));
  }

  const columns: Column<SourceWithCitationCount>[] = [
    {
      key: 'title',
      header: t('col_title'),
      sortable: true,
      render: (s) => {
        const sub = [s.Author, s.CallNumber].filter(Boolean).join(' · ');
        return (
          // The title button covers the whole row (its ::after), so a click anywhere opens the source.
          <button
            type="button"
            onClick={() => onOpen(s.Id)}
            className="flex min-w-0 items-center gap-2.5 text-left cursor-pointer focus-ring rounded-md after:absolute after:inset-0 after:content-['']"
          >
            <span aria-hidden="true" className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md bg-card-alt text-text-muted">
              <SourceTypeIcon sourceType={s.Type} size={16} strokeWidth={1.5} />
            </span>
            <span className="min-w-0">
              <span className="serif block text-base font-semibold leading-snug text-text">{titleOf(s)}</span>
              {sub && <span className="block text-meta text-text-muted">{sub}</span>}
            </span>
          </button>
        );
      },
    },
    {
      key: 'type',
      header: t('col_type'),
      sortable: true,
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell whitespace-nowrap text-sm text-text-muted',
      render: (s) => typeOf(s),
    },
    ...(hideRepository ? [] : [{
      key: 'repository',
      header: t('col_repository'),
      sortable: true,
      className: 'text-sm text-text-secondary',
      render: (s: SourceWithCitationCount) => s.RepositoryName || <span className="text-text-muted">—</span>,
    }]),
    {
      key: 'citedBy',
      header: t('col_cited_by'),
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell whitespace-nowrap',
      render: (s) => s.citedByPeople.length > 0 ? (
        <span title={s.citedByPeople.map((p) => displayFullName(p)).join(', ')} className="inline-flex">
          <AvatarStack
            size={24}
            max={4}
            treeId={treeId}
            people={s.citedByPeople.map((p) => ({ id: p.Id, name: displayFullName(p), sex: p.Sex, mediaId: p.PrimaryMediaId }))}
          />
        </span>
      ) : null,
    },
    {
      key: 'citations',
      header: t('col_citations'),
      sortable: true,
      align: 'right',
      className: 'text-sm tabular-nums text-text-secondary',
      render: (s) => s.citationCount > 0 ? (
        <span title={t('citation_count', { count: s.citationCount })}>{s.citationCount}</span>
      ) : <UncitedMark />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(s) => s.Id}
      sort={sort}
      onSortChange={handleSortChange}
      rowClassName={() => 'relative hover:bg-hover-surface'}
      empty={empty}
    />
  );
}
