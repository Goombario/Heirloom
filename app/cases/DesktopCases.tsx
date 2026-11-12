'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AvatarStack, Badge, Button, CoverBand, DataTable, EmptyState, FilterChip, InlineDataError, ListToolbar, Select, TablePanel, type Column } from '@/app/components/ui';
import { SkeletonList } from '@/app/components/SkeletonLoader';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { useActiveTreeName } from '@/app/hooks/useActiveTreeName';
import { Plus } from '@/lib/icons';
import { displayFullName } from '@/lib/utils/names';
import type { CaseWithRelations } from '@/lib/db/schema';
import { parseDate } from './_utils';
import { CaseStatus } from './CaseStatus';

export type DesktopStatus = 'all' | 'in_progress' | 'on_hold' | 'closed';
type SortKey = 'question' | 'status' | 'people' | 'leads' | 'activity';

const PAGE_SIZE = 25;
const STATUS_ORDER: Record<string, number> = { in_progress: 0, on_hold: 1, closed: 2 };
const FILTERS: { key: DesktopStatus; label: string }[] = [
    { key: 'all', label: 'filter_all' },
    { key: 'in_progress', label: 'filter_in_progress' },
    { key: 'on_hold', label: 'filter_on_hold' },
    { key: 'closed', label: 'filter_closed' },
];

const settledShare = (c: CaseWithRelations) => (c.leads && c.leads.total > 0 ? c.leads.settled / c.leads.total : -1);

/**
 * The Research list on desktop (#59): the short navy band, then search, the status
 * chips with counts, a Tag select and New case, then one white panel holding the
 * cases as a table. Closed cases are rows like the rest, so there is no separate
 * "Closed recently" section. The phone keeps its own list.
 */
export function DesktopCases({ cases, loading, loadError, onRetry, canEdit, onNewCase, search, onSearch, tag, onTag, tags, treeId }: {
    cases: CaseWithRelations[];
    /** True until the first list arrives. */
    loading: boolean;
    loadError: string | null;
    onRetry: () => void;
    /** Null while the permission is still unknown, so New case doesn't flash at a viewer. */
    canEdit: boolean | null;
    onNewCase: () => void;
    search: string;
    onSearch: (value: string) => void;
    tag: string;
    onTag: (value: string) => void;
    tags: string[];
    treeId: number | null;
}) {
    const t = useTranslations('cases');
    const tNav = useTranslations('nav');
    const tResearch = useTranslations('caseResearch');
    const tCommon = useTranslations('common');
    const treeName = useActiveTreeName();
    const { activityTime } = useTimestamp();
    const [status, setStatus] = useState<DesktopStatus>('all');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'activity', dir: 'desc' });
    const [page, setPage] = useState(1);

    const counts = useMemo(() => ({
        all: cases.length,
        in_progress: cases.filter((c) => c.Status === 'in_progress').length,
        on_hold: cases.filter((c) => c.Status === 'on_hold').length,
        closed: cases.filter((c) => c.Status === 'closed').length,
    }), [cases]);

    const rows = useMemo(() => {
        const shown = status === 'all' ? cases : cases.filter((c) => c.Status === status);
        const by: Record<SortKey, (a: CaseWithRelations, b: CaseWithRelations) => number> = {
            question: (a, b) => a.Title.localeCompare(b.Title),
            status: (a, b) => (STATUS_ORDER[a.Status] ?? 3) - (STATUS_ORDER[b.Status] ?? 3),
            people: (a, b) => a.people.length - b.people.length,
            leads: (a, b) => settledShare(a) - settledShare(b) || (a.leads?.total ?? 0) - (b.leads?.total ?? 0),
            activity: (a, b) => parseDate(a.UpdatedAt).getTime() - parseDate(b.UpdatedAt).getTime(),
        };
        const sign = sort.dir === 'asc' ? 1 : -1;
        // Ties fall back to the newest activity first, the list's own order.
        return [...shown].sort((a, b) => sign * by[sort.key](a, b) || by.activity(b, a));
    }, [cases, status, sort]);

    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const current = Math.min(page, pages);
    const paged = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
    const narrowed = search.trim() !== '' || tag !== '' || status !== 'all';
    const clear = () => { onSearch(''); onTag(''); setStatus('all'); setPage(1); };

    const columns: Column<CaseWithRelations>[] = [
        {
            key: 'question',
            header: t('col_question'),
            sortable: true,
            render: (c) => {
                const note = c.latestComment;
                const tags = c.Tags ?? [];
                return (
                    <div className="grid gap-1 py-0.5 min-w-0">
                        <Link href={`/cases/view?id=${c.Id}`} className="serif text-base font-semibold text-text no-underline hover:underline">{c.Title}</Link>
                        {note && (
                            <span className="serif text-sm italic text-text-muted truncate max-w-[520px]">
                                {/* A reopened case's old conclusion is just its last word, not its answer. */}
                                {c.Status === 'closed' && note.Kind === 'conclusion' ? t('card_conclusion', { text: note.Body }) : <>&ldquo;{note.Body}&rdquo;</>}
                            </span>
                        )}
                        {tags.length > 0 && (
                            <span className="flex flex-wrap gap-1">
                                {tags.slice(0, 5).map((tg) => <Badge key={tg}>{tg}</Badge>)}
                                {tags.length > 5 && <span className="text-xs text-text-muted">+{tags.length - 5}</span>}
                            </span>
                        )}
                    </div>
                );
            },
        },
        {
            key: 'status',
            header: t('col_status'),
            sortable: true,
            className: 'whitespace-nowrap',
            render: (c) => (
                <span className="grid gap-0.5">
                    <CaseStatus status={c.Status} />
                    {c.Status === 'closed' && c.Outcome && <span className="pl-3 text-xs text-text-muted">{tResearch(`outcome_${c.Outcome}`)}</span>}
                </span>
            ),
        },
        {
            key: 'people',
            header: t('col_people'),
            sortable: true,
            className: 'whitespace-nowrap',
            render: (c) => c.people.length === 0 ? <span className="text-text-muted">—</span> : (
                <span className="inline-flex items-center gap-2">
                    <AvatarStack
                        size={24}
                        max={3}
                        treeId={treeId}
                        people={c.people.map((p) => ({ id: p.Id, name: displayFullName(p) || tResearch('unnamed'), sex: p.Sex, mediaId: p.PrimaryMediaId ?? null }))}
                    />
                    <span className="text-sm text-text-muted tabular-nums">{c.people.length}</span>
                </span>
            ),
        },
        {
            key: 'leads',
            header: t('col_leads'),
            sortable: true,
            width: 150,
            render: (c) => !c.leads || c.leads.total === 0 ? <span className="text-text-muted">—</span> : (
                <span className="grid gap-1">
                    <span className="text-sm whitespace-nowrap tabular-nums">{t('leads_settled', { settled: c.leads.settled, total: c.leads.total })}</span>
                    <span aria-hidden="true" className="h-1 w-24 rounded-full bg-border-light">
                        <span className="block h-full rounded-full bg-text-muted" style={{ width: `${(c.leads.settled / c.leads.total) * 100}%` }} />
                    </span>
                </span>
            ),
        },
        {
            key: 'activity',
            header: t('col_last_activity'),
            sortable: true,
            align: 'right',
            className: 'whitespace-nowrap',
            render: (c) => <span className="text-sm text-text-muted">{activityTime(c.UpdatedAt)}</span>,
        },
    ];

    const total = cases.length;
    return (
        <>
            <div className="mb-4">
                <CoverBand
                    variant="short"
                    eyebrow={treeName}
                    title={tNav('research')}
                    meta={loading
                        ? <span className="skeleton inline-block h-3 w-48 rounded-[4px] opacity-40" aria-hidden="true" />
                        : rows.length !== total ? t('count_of', { filtered: rows.length, total }) : t('cases_count', { count: total })}
                />
            </div>

            <div className="mb-3">
                <ListToolbar
                    search={search}
                    onSearchChange={(v) => { onSearch(v); setPage(1); }}
                    searchLabel={t('search_label')}
                    action={canEdit
                        ? <Button variant="primary" size="md" icon={<Plus className="w-4 h-4" aria-hidden="true" />} onClick={onNewCase}>{t('new_case')}</Button>
                        : undefined}
                    filters={<>
                        {FILTERS.map((f) => (
                            <FilterChip key={f.key} label={t(f.label)} count={counts[f.key]} loading={loading}
                                active={status === f.key} onClick={() => { setStatus(f.key); setPage(1); }} />
                        ))}
                        {tags.length > 0 && (
                            <Select<string>
                                label={t('field_tags')}
                                valueLabel={tag || t('all_tags')}
                                options={[{ key: '', value: '', label: t('all_tags') }, ...tags.map((tg) => ({ key: tg, value: tg, label: tg }))]}
                                isSelected={(v) => v === tag}
                                onSelect={(v) => { onTag(v); setPage(1); }}
                            />
                        )}
                    </>}
                />
            </div>

            {loadError && cases.length > 0 && <InlineDataError className="mb-4" message={loadError} retryLabel={t('retry')} onRetry={onRetry} />}

            {loading ? (
                <div className="card overflow-hidden"><SkeletonList rows={6} /></div>
            ) : loadError && cases.length === 0 ? (
                <InlineDataError message={loadError} retryLabel={t('retry')} onRetry={onRetry} />
            ) : rows.length === 0 && (narrowed || total > 0) ? (
                <EmptyState variant="filtered" message={t('no_match')} clearLabel={tCommon('clear_filters')} onClear={clear} />
            ) : rows.length === 0 ? (
                <EmptyState
                    variant="empty"
                    title={t('empty_title')}
                    message={t('new_case_hint')}
                    action={canEdit ? <Button variant="outline" size="sm" onClick={onNewCase}>{t('new_case')}</Button> : undefined}
                />
            ) : (
                <TablePanel page={current} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage}>
                    <DataTable
                        columns={columns}
                        rows={paged}
                        rowKey={(c) => c.Id}
                        sort={sort}
                        onSortChange={(key) => setSort((s) => s.key === key
                            ? { key: s.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                            // Newest activity, most people and most settled come first.
                            : { key: key as SortKey, dir: key === 'question' || key === 'status' ? 'asc' : 'desc' })}
                    />
                </TablePanel>
            )}
        </>
    );
}
