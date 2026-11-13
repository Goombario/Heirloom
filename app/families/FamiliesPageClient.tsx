'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Button, CopperPill, CoverBand, DataTable, EmptyState, ListToolbar, MobileListHeader, PageShell, TablePanel, type Column } from '@/app/components/ui';
import { useTree } from '@/app/contexts/TreeContext';
import { Plus } from '@/lib/icons';
import { getInitials } from '@/lib/utils/initials';
import { getDataClient } from '@/lib/data';
import { prefetchFamily, cacheFamilySummaries } from './view/familyCache';
import {
    earlierDeathYear, matchesFilter, searchFamilies, sortFamilies,
    type FamilyFilterKey, type FamilySortKey,
} from './familyList';
import { MobileFamiliesFilters, MobileFamiliesRows } from './MobileFamiliesList';
import { useCachedResource } from '@/app/components/useCachedResource';
import type { ListFamiliesResult } from '@/lib/services/families';
import type { FamilyWithSpouseNames } from '@/lib/db/queries/families';
import { errorToastKey } from '@/lib/utils/data-error';
import { InlineDataError } from '@/app/components/ui';
import { useErrorToast } from '@/app/components/useErrorToast';
import PersonAvatar from '@/app/components/PersonAvatar';
import { FilterChip } from '@/app/components/ui';
import { SkeletonList } from '@/app/components/SkeletonLoader';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import type { FamilyType } from '@/lib/db/schema';
import { formatDateForDisplay, formatYearOrEmpty, sortableYear } from '@/lib/date-utils';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { NewFamilySheet, afterSheetStep } from './new/mobile/NewFamilySheet';
import { NewFamilyDialog } from './NewFamilyDialog';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { useActiveTreeName } from '@/app/hooks/useActiveTreeName';

type FilterKey = 'all' | FamilyFilterKey;
type Translator = ReturnType<typeof useTranslations>;

const FILTER_KEYS: { key: FilterKey; labelKey: string }[] = [
    { key: 'all', labelKey: 'filter_all' },
    { key: 'marriages', labelKey: 'filter_marriages' },
    { key: 'civil', labelKey: 'filter_civil' },
    { key: 'commonlaw', labelKey: 'filter_commonlaw' },
    { key: 'ended-death', labelKey: 'filter_ended_death' },
    { key: 'ended-divorce', labelKey: 'filter_ended_divorce' },
    { key: 'active', labelKey: 'filter_active' },
];

function ftypeLabel(type: FamilyType | null | undefined, t: Translator): string {
    switch (type ?? 'Marriage') {
        case 'Marriage': return t('ftype_marriage');
        case 'Civil union': return t('ftype_civil_union');
        case 'Common-law': return t('ftype_commonlaw');
        case 'Other': return t('ftype_other');
        default: return t('ftype_unknown');
    }
}

function reasonLcLabel(reason: string | null, t: Translator): string {
    switch (reason) {
        case 'Death': return t('reason_death_lc');
        case 'Divorce': return t('reason_divorce_lc');
        case 'Separation': return t('reason_separation_lc');
        case 'Annulment': return t('reason_annulment_lc');
        default: return t('reason_unknown_lc');
    }
}

function yearOnly(date: string | null): string {
    return formatYearOrEmpty(date);
}

/**
 * The partnership's name split one partner per line (#483).
 *
 * Two full names on a single line wrap wherever the column happens to run out,
 * so a partner's given name ends one line and their surname starts the next —
 * which is precisely what makes the list hard to scan for a person. One line per
 * partner puts every name at a predictable left edge instead. Taller rows are
 * the accepted cost: most rows already spilled to two lines anyway.
 *
 * Both surfaces call this, so the mobile card and the desktop table can no
 * longer disagree about the name form (they were surnames-only + " & " and full
 * names + " + " respectively) — the unification half of the same decision.
 * Returns [] when neither partner is named; the caller supplies the fallback.
 */
export function partnerNameLines(p1: string | null | undefined, p2: string | null | undefined): string[] {
    return [p1?.trim(), p2?.trim()].filter((n): n is string => Boolean(n));
}

/**
 * One rendered name line. The second partner keeps the ampersand so the pair
 * still reads as one partnership when the lines are scanned in isolation — and
 * so the conjunction is not carried by layout alone.
 */
export function PartnerNameLines({ lines, fallback, className }: { lines: string[]; fallback: string; className?: string }) {
    if (lines.length === 0) return <span className={className}>{fallback}</span>;
    return (
        <>
            {lines.map((name, i) => (
                <span key={name + String(i)} className={className}>
                    {i > 0 ? `& ${name}` : name}
                </span>
            ))}
        </>
    );
}

function partnerAvatar(
    name: string | null,
    sex: string | null,
    mediaId: number | null,
    focalX: number | null,
    focalY: number | null,
    focalRadius: number | null,
    treeId: number | null,
    overlap: boolean,
    size: number = 28,
) {
    const parts = (name ?? '').trim().split(/\s+/);
    const first = parts[0] ?? '';
    const last = parts[parts.length - 1] ?? '';
    return (
        <span className={`inline-flex ${overlap ? '-ml-2' : 'ml-0'}`}>
            <PersonAvatar
                as="span"
                // Show the photo whenever one exists — ProfileImage resolves media
                // without a treeId (as People does); treeId only scopes shared trees.
                mediaId={mediaId}
                treeId={treeId}
                name={name ?? ''}
                initials={getInitials(first, last)}
                sex={sex}
                size={size}
                focalX={focalX}
                focalY={focalY}
                focalRadius={focalRadius}
                ringClassName="border-2 border-card"
            />
        </span>
    );
}

/** "1960 · death of Aster": the Ended cell as text, year in `.date-mono` (#757).
 *  Tags are for states; an ended partnership is a fact about it. */
function endedText(year: string, text: string): React.ReactNode {
    return (
        <span className="text-meta">
            {year && <><span className="date-mono date-muted">{year}</span><span className="text-text-muted"> · </span></>}
            <span className="text-text-muted">{text}</span>
        </span>
    );
}

export function endedLabel(family: FamilyWithSpouseNames, t: Translator): React.ReactNode {
    // Explicit ended event takes precedence
    if (family.EndedDate || family.EndedReason) {
        return endedText(yearOnly(family.EndedDate), reasonLcLabel(family.EndedReason ?? 'Unknown', t));
    }
    // Derived: at least one partner deceased
    const a = sortableYear(family.partner1DeathDate);
    const b = sortableYear(family.partner2DeathDate);
    const earlier = earlierDeathYear(family.partner1DeathDate, family.partner2DeathDate);
    if (earlier !== null) {
        const whichName = a !== null && (b === null || a <= b) ? family.husbandName?.split(' ')[0] : family.wifeName?.split(' ')[0];
        return endedText(String(earlier), t('ended_death_of', { name: whichName ?? t('death_of_partner') }));
    }
    // No end yet — assume active
    return <span className="text-meta text-text-secondary">{t('active_pill')}</span>;
}

const ITEMS_PER_PAGE = 50;

const familiesListKey = (treeId: number | null) => `families:list:tree=${treeId ?? 'default'}`;

export default function FamiliesPageClient({
    initialFamilies,
}: {
    initialFamilies: ListFamiliesResult | null;
}) {
    const router = useRouter();
    const t = useTranslations('families');
    const locale = useLocale();
    const tCommon = useTranslations('common');
    const tPeople = useTranslations('people');
    const { language } = useLanguage();
    const dateWords = useDateQualifierWords();
    const { activeTreeId, activePermission, currentUserId } = useTree();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
    const [currentPage, setCurrentPage] = useState(1);
    type SortKey = FamilySortKey;
    const [sortKey, setSortKey] = useState<SortKey>('partner');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    // New family is a sheet over this list on a phone (#1066) and a quick-add dialog on
    // a wider screen (#52). `?add=1` opens it, which is where /families/new sends everyone.
    const [adding, setAdding] = useState(false);
    const phone = useIsMobile();
    const searchParams = useSearchParams();
    const wantsAdd = searchParams.get('add') === '1';
    const { redirectIfUnauthorized } = useErrorToast();

    function toggleSort(key: SortKey) {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('asc');
        }
    }

    const { data, loading, error, retry } = useCachedResource(
        currentUserId === null ? null : familiesListKey(activeTreeId),
        async () => {
            const client = await getDataClient();
            return await client.families.list(activeTreeId);
        },
        // The SSR seed is always the user's default tree (TreeContext starts at
        // activeTreeId=null); a restored non-default selection misses this key.
        initialFamilies !== null
            ? { key: familiesListKey(null), data: initialFamilies }
            : undefined,
    );
    useEffect(() => {
        if (error) redirectIfUnauthorized(error);
    }, [error, redirectIfUnauthorized]);
    const families = useMemo(() => data?.families ?? [], [data]);

    // Index loaded rows as partnership summaries so an un-prefetched jump to a family
    // paints the hero (both partner names/avatars, marriage line) instantly instead of
    // a blank while `families.get` resolves.
    useEffect(() => { cacheFamilySummaries(data?.families ?? [], activeTreeId); }, [data, activeTreeId]);

    useDocumentTitle(t('title'));

    useEffect(() => {
        // Reset to the first page whenever a filter/sort/search input changes, or
        // the active tree switches (a smaller tree would otherwise strand the user
        // on a now-out-of-range page showing an empty list).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCurrentPage(1);
    }, [searchQuery, activeFilter, sortKey, sortDir, activeTreeId]);

    const filtered = useMemo(() => {
        const searched = searchFamilies(families, searchQuery);
        const result = activeFilter === 'all' ? searched : searched.filter(f => matchesFilter(f, activeFilter));
        return sortFamilies(result, sortKey, sortDir === 'asc', locale);
    }, [families, locale, searchQuery, activeFilter, sortKey, sortDir]);

    const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
    const pagedFamilies = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

    const totalPartnerships = families.length;
    const counts = useMemo(() => {
        const m = families.filter(f => (f.Type ?? 'Marriage') === 'Marriage').length;
        const c = families.filter(f => f.Type === 'Civil union').length;
        const cl = families.filter(f => f.Type === 'Common-law').length;
        const ed = families.filter(f => matchesFilter(f, 'ended-death')).length;
        const edv = families.filter(f => matchesFilter(f, 'ended-divorce')).length;
        const act = families.filter(f => matchesFilter(f, 'active')).length;
        return { m, c, cl, ed, edv, act };
    }, [families]);

    const canEdit = activePermission !== 'view';
    const treeName = useActiveTreeName();
    // Opened once per `?add=1`, as soon as the permission is known.
    const [addSeen, setAddSeen] = useState(false);
    if (wantsAdd !== addSeen && (!wantsAdd || activePermission !== null)) {
        setAddSeen(wantsAdd);
        if (wantsAdd && canEdit) setAdding(true);
    }
    useEffect(() => {
        if (!wantsAdd || activePermission === null) return;
        const rest = new URLSearchParams(searchParams.toString());
        rest.delete('add');
        router.replace(rest.size > 0 ? `/families?${rest}` : '/families', { scroll: false });
    }, [wantsAdd, activePermission, router, searchParams]);
    // Skeleton-first, with "user still resolving" (currentUserId === null) treated
    // as loading so the prerendered HTML ships the skeleton rather than an empty
    // body. Gated on families.length so a cache hit with data skips the skeleton.
    const phase = useLoadPhase((currentUserId === null || loading) && families.length === 0, { delay: 0 });

    // Below md the dark header names the page and the list runs edge to edge (#1064).
    const shell = { topBar: <MobileListHeader title={t('title')} />, contentClassName: 'max-md:p-0!' };
    // Desktop (#59): the short navy band (tree, title, counts). The title is known
    // before the fetch resolves, so only the counts line skeletons.
    const band = (
        <div className="hidden md:block mb-4">
            <CoverBand
                variant="short"
                eyebrow={treeName}
                title={t('title')}
                meta={phase === 'ready'
                    ? (filtered.length !== totalPartnerships ? t('count_of', { filtered: filtered.length, total: totalPartnerships }) : t('partnerships_count', { count: totalPartnerships }))
                    : <span className="skeleton inline-block h-3 w-48 rounded-[4px] opacity-40" aria-hidden="true" />}
            />
        </div>
    );

    if (phase === 'loading') {
        return (
            <PageShell {...shell}>
                {band}
                <div className="md:hidden"><SkeletonList rows={8} /></div>
                <div className="hidden md:block card overflow-hidden">
                    <SkeletonList rows={8} />
                </div>
            </PageShell>
        );
    }

    const familyColumns: Column<FamilyWithSpouseNames>[] = [
        {
            key: 'partner',
            header: t('col_partnership'),
            sortable: true,
            render: (f) => {
                const nameLines = partnerNameLines(f.husbandName, f.wifeName);
                // Marriage order in words, on a muted sub-line: "Aster's 1st
                // marriage of 2". "X of Y" is left to mean sourcing (#757).
                const seqRank = (() => {
                    const r1 = f.partner1MarriageRank, t1 = f.partner1MarriageTotal;
                    const r2 = f.partner2MarriageRank, t2 = f.partner2MarriageTotal;
                    const key = (f.Type ?? 'Marriage') === 'Marriage' ? 'seq_marriage' : 'seq_partnership';
                    const first = (name: string | null) => name?.split(' ')[0] || t('death_of_partner');
                    if (t1 && t1 > 1) return t(key, { name: first(f.husbandName), rank: r1 ?? 0, total: t1 });
                    if (t2 && t2 > 1) return t(key, { name: first(f.wifeName), rank: r2 ?? 0, total: t2 });
                    return null;
                })();
                return (
                    <Link
                        href={`/families/view?id=${f.Id}`}
                        className="flex items-center gap-2.5 no-underline text-sm"
                        style={{ color: 'inherit' }}
                    >
                        <div className="flex items-center">
                            {partnerAvatar(f.husbandName, f.partner1Sex, f.husbandMediaId, f.husbandFocalX, f.husbandFocalY, f.husbandFocalRadius, activeTreeId, false)}
                            {partnerAvatar(f.wifeName, f.partner2Sex, f.wifeMediaId, f.wifeFocalX, f.wifeFocalY, f.wifeFocalRadius, activeTreeId, true)}
                        </div>
                        {/* The couple on one line, "Johan Lindqvist & Anna Holm", as on the locked list board. */}
                        <span className="serif text-base font-semibold text-text min-w-0">
                            {nameLines.length === 0 ? t('partnership_fallback', { id: f.Id }) : nameLines.map((name, i) => (
                                <span key={name + String(i)}>{i > 0 && <span className="font-sans font-normal text-text-muted"> &amp; </span>}{name}</span>
                            ))}
                            {seqRank && <span className="block font-sans text-xs font-normal text-text-muted">{seqRank}</span>}
                        </span>
                    </Link>
                );
            },
        },
        {
            key: 'type',
            header: t('col_type'),
            sortable: true,
            // Below lg the type chips above the table carry it; the column wrapped
            // "Common-law" and squeezed the partner names (#806, T-2).
            headerClassName: 'hidden lg:table-cell',
            className: 'hidden lg:table-cell',
            // Plain text, not a pill — the page carries too much colour otherwise.
            render: (f) => <span className="text-sm">{ftypeLabel(f.Type, t)}</span>,
        },
        {
            key: 'began',
            header: t('col_began'),
            sortable: true,
            // Full date, like the People table's Birth and Death (#780, TB-2); the
            // Ended column stays a compact "year · reason" state line (#757).
            className: 'whitespace-nowrap',
            render: (f) => <span className="date-mono text-sm">{formatDateForDisplay(f.MarriageDate, language, dateWords) || <span className="muted">—</span>}</span>,
        },
        {
            key: 'ended',
            header: t('col_ended'),
            sortable: true,
            render: (f) => endedLabel(f, t),
        },
        {
            key: 'children',
            header: t('col_children'),
            align: 'right',
            sortable: true,
            render: (f) => f.childCount > 0 ? (
                // Below lg the "(1 died young)" note takes its own line rather than
                // widen the column at 768 (#806).
                <span className="text-sm tabular-nums lg:whitespace-nowrap">
                    {f.childCount}
                    {f.youngDeathCount > 0 && (
                        <span className="muted block lg:inline lg:ml-1.5 text-meta">
                            {t('died_young', { count: f.youngDeathCount })}
                        </span>
                    )}
                </span>
            ) : (
                <span className="muted">—</span>
            ),
        },
        {
            key: 'place',
            header: t('col_place'),
            sortable: true,
            // Hidden below lg rather than squeezed: at 768 it pushed partner names
            // to one word per line and cut the last column (#806, T-2).
            headerClassName: 'hidden lg:table-cell',
            className: 'muted hidden lg:table-cell',
            render: (f) => (
                <span className="inline-block align-middle text-sm max-w-[200px] truncate">
                    {f.MarriagePlace || '—'}
                </span>
            ),
        },
        {
            key: 'sources',
            header: t('col_sources'),
            align: 'right',
            width: 80,
            sortable: true,
            render: (f) => {
                const total = f.TotalFacts ?? 0;
                const sourced = f.SourcedFacts ?? 0;
                if (total === 0) return <span className="muted text-xs">—</span>;
                // "X of Y" as text; the header already says what it counts. Evidence
                // amber once every fact is sourced (audit §13 addendum, 2026-09-23).
                return (
                    <span className={`text-xs whitespace-nowrap tabular-nums ${sourced >= total ? 'text-evidence' : 'text-text-muted'}`}>
                        {t('sources_of', { sourced, total })}
                    </span>
                );
            },
        },
    ];

    return (
        <PageShell {...shell}>
                {band}
                {/* Phone: the filter field and chips, sliding away on scroll down */}
                <MobileFamiliesFilters
                    query={searchQuery}
                    onQuery={setSearchQuery}
                    filter={activeFilter === 'all' ? null : activeFilter}
                    onFilter={(key) => setActiveFilter(key ?? 'all')}
                />

                {/* Desktop: search, the filter chips with counts, then the one main button (#59) */}
                <div className="hidden md:block mb-3">
                    <ListToolbar
                        search={searchQuery}
                        onSearchChange={setSearchQuery}
                        searchLabel={t('search_placeholder_redesign')}
                        // activePermission starts null, which canEdit reads as editable, so the
                        // button waits for it rather than flash at a view-only collaborator.
                        // One create path per screen (FL-2): the copper pill takes over below md.
                        action={activePermission !== null && canEdit
                            ? <Button variant="primary" size="md" icon={<Plus className="w-4 h-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('new_family')}</Button>
                            : undefined}
                        filters={<>
                        {FILTER_KEYS.map(f => {
                            const count = (() => {
                                switch (f.key) {
                                    case 'marriages': return counts.m;
                                    case 'civil': return counts.c;
                                    case 'commonlaw': return counts.cl;
                                    case 'ended-death': return counts.ed;
                                    case 'ended-divorce': return counts.edv;
                                    case 'active': return counts.act;
                                    default: return totalPartnerships;
                                }
                            })();
                            return (
                                <FilterChip
                                    key={f.key}
                                    label={t(f.labelKey)}
                                    count={count}
                                    active={activeFilter === f.key}
                                    onClick={() => setActiveFilter(f.key)}
                                />
                            );
                        })}
                        </>}
                    />
                </div>

                {error != null && (
                    <InlineDataError
                        className="mt-1.5 max-md:mx-4 max-md:mt-3"
                        message={String(tCommon(errorToastKey(error)))}
                        retryLabel={String(tCommon('retry'))}
                        onRetry={retry}
                    />
                )}

                {/* Empty state */}
                {error == null && filtered.length === 0 && (
                    <div className="mt-1.5 max-md:px-4">
                        {families.length === 0 ? (
                            <EmptyState
                                variant="empty"
                                title={t('empty_title')}
                                message={t('empty_hint')}
                                action={activePermission !== null && canEdit ? (
                                    <>
                                        <span className="md:hidden">
                                            <CopperPill icon={<Plus aria-hidden="true" />} onClick={() => setAdding(true)}>{t('add_family')}</CopperPill>
                                        </span>
                                        <span className="hidden md:inline">
                                            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>{t('new_family')}</Button>
                                        </span>
                                    </>
                                ) : undefined}
                            />
                        ) : (
                            <EmptyState
                                variant="filtered"
                                message={t('no_match')}
                                clearLabel={tCommon('clear_filters')}
                                onClear={() => { setSearchQuery(''); setActiveFilter('all'); }}
                            />
                        )}
                    </div>
                )}

                {filtered.length > 0 && (
                    <>
                        <MobileFamiliesRows
                            rows={pagedFamilies}
                            count={filtered.length !== totalPartnerships
                                ? t('count_of', { filtered: filtered.length, total: totalPartnerships })
                                : tPeople('count_total', { total: totalPartnerships })}
                            treeId={activeTreeId}
                            column={sortKey}
                            ascending={sortDir === 'asc'}
                            onSort={(key, asc) => { setSortKey(key); setSortDir(asc ? 'asc' : 'desc'); }}
                            page={currentPage}
                            pages={totalPages}
                            onPage={(n) => { setCurrentPage(n); window.scrollTo({ top: 0 }); }}
                        />

                        {/* Desktop: one white panel holds the table, the pager in its footer (#59) */}
                        <div className="hidden md:block">
                            <TablePanel page={currentPage} pageSize={ITEMS_PER_PAGE} total={filtered.length} onPage={setCurrentPage}>
                                <DataTable
                                    columns={familyColumns}
                                    rows={pagedFamilies}
                                    rowKey={(f) => f.Id}
                                    sort={{ key: sortKey, dir: sortDir }}
                                    onSortChange={(key) => toggleSort(key as SortKey)}
                                    onRowPrefetch={(f) => prefetchFamily(f.Id, activeTreeId)}
                                    density="list"
                                />
                            </TablePanel>
                        </div>
                    </>
                )}

            {/* The phone's one copper pill, floating, sliding away on scroll down. The
                spacer lets the last rows scroll clear of it. An empty tree offers it in
                the empty state instead. */}
            {activePermission !== null && canEdit && families.length > 0 && (
                <>
                    <div className="h-24 md:hidden" aria-hidden="true" />
                    <CopperPill floating icon={<Plus aria-hidden="true" />} onClick={() => setAdding(true)}>{t('add_family')}</CopperPill>
                </>
            )}
            {activePermission !== null && canEdit && (
                phone ? (
                    <NewFamilySheet
                        open={adding}
                        onClose={() => setAdding(false)}
                        onCreated={(id) => {
                            setAdding(false);
                            afterSheetStep(() => router.push(`/families/view?id=${id}`));
                        }}
                    />
                ) : (
                    <NewFamilyDialog
                        open={adding}
                        onClose={() => setAdding(false)}
                        onCreated={(id) => { setAdding(false); router.push(`/families/view?id=${id}`); }}
                    />
                )
            )}
        </PageShell>
    );
}
