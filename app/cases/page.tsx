'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTree } from '@/app/contexts/TreeContext';
import { Plus } from '@/lib/icons';
import type { CaseWithRelations } from '@/lib/db/schema';
import { parseDate } from './_utils';
import { CaseStatus } from './CaseStatus';
import { writtenEntries } from './view/case-detail-helpers';
import { FilterChip, Button, Badge, EmptyState, InlineDataError, PageShell, Select } from '@/app/components/ui';
import SearchBar from '@/app/components/SearchBar';
import { SkeletonGrid } from '@/app/components/SkeletonLoader';
import { useDebounce } from '@/app/hooks/useDebounce';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { MobileCases } from './MobileCases';

type StatusFilter = 'in_progress' | 'on_hold' | 'closed' | '';

export default function CasesPage() {
    const router = useRouter();
    const { activeTreeId, activePermission, currentUserId } = useTree();
    const treeKey = activeTreeId == null ? 'default' : String(activeTreeId);
    const [cases, setCases] = useState<CaseWithRelations[]>([]);
    const [casesTreeKey, setCasesTreeKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadErrorTreeKey, setLoadErrorTreeKey] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('in_progress');
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 300);
    const [tagFilter, setTagFilter] = useState('');
    const [allTags, setAllTags] = useState<string[]>([]);
    const requestIdRef = useRef(0);
    const { redirectIfUnauthorized } = useErrorToast();

    const t = useTranslations('cases');
    const tCommon = useTranslations('common');
    const isMobile = useIsMobile();

    const { activityTime } = useTimestamp();

    const fetchCases = useCallback(async () => {
        if (currentUserId === null) return;
        const requestId = ++requestIdRef.current;
        const isCurrent = () => requestIdRef.current === requestId;
        setLoading(true);
        setLoadError(null);
        setLoadErrorTreeKey(null);
        try {
            // Fetch all (no status filter on server) so we can show counts and the Closed Recently section.
            const client = await getDataClient();
            if (!isCurrent()) return;
            const { cases: fetched } = await client.cases.list({
                treeId: activeTreeId,
                search: debouncedSearch || undefined,
                tag: tagFilter || undefined,
            });
            if (!isCurrent()) return;
            setCases(fetched);
            setCasesTreeKey(treeKey);
            const tagSet = new Set<string>();
            fetched.forEach(c => c.Tags?.forEach(tag => tagSet.add(tag)));
            setAllTags(Array.from(tagSet).sort());
        } catch (err) {
            if (!isCurrent()) return;
            if (redirectIfUnauthorized(err)) return;
            console.error('Failed to fetch cases:', err);
            setLoadError(t('load_error'));
            setLoadErrorTreeKey(treeKey);
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [activeTreeId, currentUserId, debouncedSearch, tagFilter, redirectIfUnauthorized, t, treeKey]);

    useEffect(() => { fetchCases(); }, [fetchCases]);
    useDocumentTitle(t('title'));

    const canEdit = activePermission !== 'view';
    // delay: 0 — skeleton-first. The default 200ms `pending` window renders null, so a
    // hard reload painted blank → skeleton → data. See the same opt-in on the dashboard,
    // People, Families and Places.
    // Keep a previously loaded list visible while a filter/search revalidation is
    // in flight. A skeleton is reserved for the cold load where there is no
    // stale content to anchor the page.
    const currentCases = useMemo(() => casesTreeKey === treeKey ? cases : [], [casesTreeKey, treeKey, cases]);
    const currentTags = casesTreeKey === treeKey ? allTags : [];
    const currentLoadError = loadErrorTreeKey === treeKey ? loadError : null;
    const phase = useLoadPhase(currentUserId === null || ((loading || (casesTreeKey !== treeKey && !currentLoadError)) && currentCases.length === 0), { delay: 0 });

    const counts = useMemo(() => ({
        inProgress: currentCases.filter(c => c.Status === 'in_progress').length,
        onHold: currentCases.filter(c => c.Status === 'on_hold').length,
        closed: currentCases.filter(c => c.Status === 'closed').length,
        all: currentCases.length,
    }), [currentCases]);

    // A search or tag narrows the list; the status chip alone doesn't when nothing
    // is open, so a tree whose cases are all closed says so plainly (#801, CS-3).
    const narrowed = search.trim() !== '' || debouncedSearch !== '' || tagFilter !== '';
    const openCount = counts.inProgress + counts.onHold;

    const visibleCases = useMemo(() => {
        if (statusFilter === '') return currentCases.filter(c => c.Status !== 'closed');
        return currentCases.filter(c => c.Status === statusFilter);
    }, [currentCases, statusFilter]);

    const closedRecent = useMemo(() => {
        return currentCases
            .filter(c => c.Status === 'closed')
            .sort((a, b) => parseDate(b.UpdatedAt).getTime() - parseDate(a.UpdatedAt).getTime())
            .slice(0, 4);
    }, [currentCases]);

    if (isMobile) {
        return (
            <MobileCases
                treeId={activeTreeId}
                phase={phase}
                loadError={currentLoadError}
                onRetry={fetchCases}
                canEdit={canEdit}
                search={search}
                onSearch={setSearch}
                statusFilter={statusFilter}
                onStatus={setStatusFilter}
                tagFilter={tagFilter}
                onTag={setTagFilter}
                tags={currentTags}
                counts={counts}
                visible={visibleCases}
                closedRecent={closedRecent}
                filtered={narrowed || statusFilter === 'closed' || (statusFilter !== '' && openCount > 0)}
                total={currentCases.length}
                onClearFilters={() => { setSearch(''); setTagFilter(''); setStatusFilter(''); }}
            />
        );
    }

    return (
        <PageShell
            title={t('title')}
            subtitle={t('subtitle_threads')}
            actions={canEdit && (
                <Button variant="primary" size="md" icon={<Plus className="w-4 h-4" aria-hidden="true" />} onClick={() => router.push('/cases/new')} className="text-sm">
                    {t('new_case')}
                </Button>
            )}
        >

                {/* Search + filter chips — sticky on mobile */}
                <div className="mobile-sticky-filters">
                    {/* Search row. The tag filter is its own control beside the
                        search, not inside its field; on phones it wraps under it (#915). */}
                    <div className="flex flex-wrap items-center gap-x-2">
                        <div className="basis-full min-w-0 md:basis-0 md:flex-1">
                            <SearchBar
                                value={search}
                                onChange={setSearch}
                                placeholder={t('search_placeholder')}
                                clearLabel={t('clear_search')}
                            />
                        </div>
                        {currentTags.length > 0 && (
                            <Select<string>
                                className="mb-2"
                                label={t('field_tags')}
                                valueLabel={tagFilter || t('all_tags')}
                                options={[{ key: '', value: '', label: t('all_tags') }, ...currentTags.map((tag) => ({ key: tag, value: tag, label: tag }))]}
                                isSelected={(v) => v === tagFilter}
                                onSelect={setTagFilter}
                            />
                        )}
                    </div>

                    {/* Filter chips */}
                    <div className="list-filter-chips mb-1">
                        <FilterChip
                            label={t('filter_in_progress')}
                            count={counts.inProgress}
                            loading={phase !== 'ready'}
                            active={statusFilter === 'in_progress'}
                            onClick={() => setStatusFilter(prev => prev === 'in_progress' ? '' : 'in_progress')}
                        />
                        <FilterChip
                            label={t('filter_on_hold')}
                            count={counts.onHold}
                            loading={phase !== 'ready'}
                            active={statusFilter === 'on_hold'}
                            onClick={() => setStatusFilter(prev => prev === 'on_hold' ? '' : 'on_hold')}
                        />
                        <FilterChip
                            label={t('filter_closed')}
                            count={counts.closed}
                            loading={phase !== 'ready'}
                            active={statusFilter === 'closed'}
                            onClick={() => setStatusFilter(prev => prev === 'closed' ? '' : 'closed')}
                        />
                        <div className="hidden md:block flex-1" />
                        <span className="muted hidden md:inline text-meta shrink-0">{t('sort_recent')}</span>
                    </div>
                </div>

                {currentLoadError && currentCases.length > 0 && (
                    <InlineDataError
                        className="mb-4"
                        message={currentLoadError}
                        retryLabel={t('retry')}
                        onRetry={fetchCases}
                    />
                )}

                {/* Cases grid */}
                {phase === 'loading' ? (
                    // Same `.cases-grid` template as the loaded list (2 columns, 1 on mobile)
                    // so the page doesn't reflow when the cases arrive (#698).
                    <SkeletonGrid columns={null} className="cases-grid" aspectRatio="3 / 1" gap={14} items={4} />
                ) : phase === 'pending' ? null : currentLoadError && currentCases.length === 0 ? (
                    <InlineDataError
                        message={currentLoadError}
                        retryLabel={t('retry')}
                        onRetry={fetchCases}
                    />
                ) : visibleCases.length === 0 && (narrowed || statusFilter === 'closed' || (statusFilter !== '' && openCount > 0)) ? (
                    <EmptyState
                        variant="filtered"
                        message={t('no_match')}
                        clearLabel={tCommon('clear_filters')}
                        onClear={() => { setSearch(''); setTagFilter(''); setStatusFilter(''); }}
                    />
                ) : visibleCases.length === 0 ? (
                    // Nothing open: a brand-new tree, or every case is closed (listed below).
                    <EmptyState
                        variant="empty"
                        title={currentCases.length === 0 ? t('empty_title') : t('no_open_cases')}
                        message={t('new_case_hint')}
                        action={canEdit ? (
                            <Button variant="outline" size="sm" onClick={() => router.push('/cases/new')}>{t('new_research_case')}</Button>
                        ) : undefined}
                    />
                ) : (
                    <div className="cases-grid">
                        {visibleCases.map(c => {
                            const peopleCount = c.people?.length ?? 0;
                            const sourceCount = c.citations?.length ?? 0;
                            const commentCount = writtenEntries(c.comments ?? []).length;
                            return (
                                <Link
                                    key={c.Id}
                                    href={`/cases/view?id=${c.Id}`}
                                    className="card p-[18px] no-underline text-inherit flex flex-col gap-2.5"
                                >
                                    <div className="row justify-between gap-2">
                                        <CaseStatus status={c.Status} />
                                        <span className="muted text-xs">{activityTime(c.UpdatedAt)}</span>
                                    </div>

                                    <div className="serif text-xl font-semibold leading-snug">
                                        {c.Title}
                                    </div>

                                    {c.latestComment && (
                                        <div
                                            className="muted serif text-sm italic leading-normal line-clamp-2"
                                        >
                                            {/* A reopened case's old conclusion is just its last word, not its answer. */}
                                            {c.Status === 'closed' && c.latestComment.Kind === 'conclusion'
                                                ? t('card_conclusion', { text: c.latestComment.Body })
                                                : <>&ldquo;{c.latestComment.Body}&rdquo;</>}
                                        </div>
                                    )}

                                    {c.Tags && c.Tags.length > 0 && (
                                        <div className="row gap-1 flex-wrap">
                                            {c.Tags.slice(0, 5).map(tag => (
                                                <Badge key={tag} className="text-[10px]">{tag}</Badge>
                                            ))}
                                            {c.Tags.length > 5 && (
                                                <span className="muted text-[10px]">+{c.Tags.length - 5}</span>
                                            )}
                                        </div>
                                    )}

                                    <div
                                        className="row muted border-t border-t-[color:var(--border-light)] pt-2.5 text-meta gap-3.5"
                                    >
                                        <span>{t('people_count', { count: peopleCount })}</span>
                                        <span>{t('sources_count', { count: sourceCount })}</span>
                                        <span>{t('notes_count', { count: commentCount })}</span>
                                    </div>
                                </Link>
                            );
                        })}

                    </div>
                )}

                {/* Closed recently */}
                {statusFilter !== 'closed' && closedRecent.length > 0 && (
                    <>
                        <h2 className="section serif mt-7">
                            {t('closed_recently')} <span className="muted font-normal text-sm">({counts.closed})</span>
                        </h2>
                        <div className="card overflow-hidden">
                            {closedRecent.map((c, i) => (
                                <Link
                                    key={c.Id}
                                    href={`/cases/view?id=${c.Id}`}
                                    className={`row py-3 px-4 no-underline text-inherit gap-3 ${i < closedRecent.length - 1 ? 'border-b border-b-[color:var(--border-light)]' : ''}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-base">
                                            <span className="text-[color:var(--color-success)] mr-1.5">✓</span>
                                            {c.Title}
                                        </div>
                                        {c.latestComment && (
                                            <div
                                                className="muted text-meta mt-[3px] line-clamp-1"
                                            >
                                                {c.latestComment.Kind === 'conclusion'
                                                    ? t('card_conclusion', { text: c.latestComment.Body })
                                                    : c.latestComment.Body}
                                            </div>
                                        )}
                                    </div>
                                    <span className="muted text-xs shrink-0">
                                        {activityTime(c.UpdatedAt)}
                                    </span>
                                </Link>
                            ))}
                        </div>
                    </>
                )}
        </PageShell>
    );
}
