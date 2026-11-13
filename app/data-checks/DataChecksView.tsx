'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card, CoverBand, EmptyState, FilterChip, InlineDataError, Input, PageShell, SegmentedControl, Select, cx, showSuccessToast } from '@/app/components/ui';
import { SkeletonList } from '@/app/components/SkeletonLoader';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useTree } from '@/app/contexts/TreeContext';
import { Search } from '@/lib/icons';
import { getDataClient } from '@/lib/data';
import type { DataChecksResult } from '@/lib/data/types';
import { DATA_CHECK_RULES, type DataCheckKind, type DataCheckRuleId } from '@/lib/data-checks/rules';
import { errorToastKey } from '@/lib/utils/data-error';
import { displayGivenNames } from '@/lib/utils/names';
import { parseIdParam } from '@/lib/utils/parse-id';
import { DataCheckDetail } from './DataCheckDetail';
import { DataCheckList } from './DataCheckList';
import {
    PAGE_SIZE, applyRule, entriesInTab, filterEntries, pageCount, pageGroups, pageKindGroups, pageOfIndex, personName, ruleCounts,
    type DataCheckTab,
} from './model';
import { useDataCheckText } from './useDataCheckText';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { MobileDataCheckEntry, MobileDataChecksList } from './MobileDataChecks';

const EMPTY: DataChecksResult = { problems: [], people: [], families: [] };
const KIND_GROUP: Record<DataCheckKind, string> = { impossible: 'group_impossible', unlikely: 'group_unlikely', unreadable: 'group_unreadable' };

/**
 * The Data checks page (#831). From 768 up it is the Places Explore recipe: a
 * full-width header with the filters, then one card with the list beside the
 * detail. Below 768 the list is full width, and an entry opens the detail full
 * screen. The selected entry and the family filter live in the query.
 */
export default function DataChecksView() {
    const t = useTranslations('dataChecks');
    const tCommon = useTranslations('common');
    const tNav = useTranslations('nav');
    useDocumentTitle(t('title'));
    const { activeTreeId, activePermission } = useTree();
    const { redirectIfUnauthorized } = useErrorToast();
    const router = useRouter();
    const isMobile = useIsMobile();
    const params = useSearchParams();
    const entryParam = params.get('entry');
    const familyId = parseIdParam(params.get('family'));

    const [result, setResult] = useState<DataChecksResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<DataCheckTab>('open');
    const [rule, setRule] = useState<DataCheckRuleId | null>(null);
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const headingRef = useRef<HTMLHeadingElement>(null);
    // The entry whose heading takes focus once it renders. Held by id, because a
    // reload can briefly show another entry before the route catches up.
    const focusDetail = useRef<string | null>(null);

    const load = useCallback(async (): Promise<DataChecksResult | null> => {
        setError(null);
        try {
            const client = await getDataClient();
            const next = await client.dataChecks.list(activeTreeId);
            setResult(next);
            return next;
        } catch (e) {
            if (!redirectIfUnauthorized(e)) setError(tCommon(errorToastKey(e)));
            return null;
        }
    }, [activeTreeId, redirectIfUnauthorized, tCommon]);

    useEffect(() => { void load(); }, [load]);

    const data = result ?? EMPTY;
    const text = useDataCheckText(data.people);
    const inTab = useMemo(() => entriesInTab(data.problems, tab), [data.problems, tab]);
    const filtered = useMemo(
        () => filterEntries(data.problems, { tab, familyId, query }, text.byId),
        [data.problems, tab, familyId, query, text.byId],
    );
    const counts = useMemo(() => ruleCounts(filtered), [filtered]);
    const activeRule = rule && counts.some((c) => c.rule === rule) ? rule : null;
    const entries = useMemo(() => applyRule(filtered, activeRule), [filtered, activeRule]);

    const pages = pageCount(entries);
    const shownPage = Math.min(page, pages);
    const selectedIndex = entryParam ? entries.findIndex((e) => e.id === entryParam) : -1;
    // With no entry chosen (or one filtered out), the wide layout shows the first on the page.
    const currentIndex = selectedIndex >= 0 ? selectedIndex : Math.min((shownPage - 1) * PAGE_SIZE, entries.length - 1);
    const current = currentIndex >= 0 ? entries[currentIndex] : null;
    const groups = useMemo(() => pageGroups(entries, shownPage), [entries, shownPage]);
    const kindGroups = useMemo(() => pageKindGroups(entries, shownPage), [entries, shownPage]);

    // A linked entry (Back, a deep link, a hero flag) opens the list at its page.
    const linkedPage = selectedIndex >= 0 ? pageOfIndex(selectedIndex) : null;
    useEffect(() => {
        if (linkedPage != null) setPage(linkedPage);
        // Only when the linked entry changes, so paging the list stays free.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entryParam, result]);

    const hrefFor = useCallback((entryId: string | null) => {
        const q = new URLSearchParams();
        if (entryId) q.set('entry', entryId);
        if (familyId != null) q.set('family', String(familyId));
        const s = q.toString();
        return s ? `/data-checks?${s}` : '/data-checks';
    }, [familyId]);

    // `replace` for the phone's up and down: with the menu where Back was, the phone's
    // own Back has to return to the list, not step back through every entry seen.
    const open = useCallback((index: number, replace = false) => {
        const target = entries[index];
        if (!target) return;
        setPage(pageOfIndex(index));
        focusDetail.current = target.id;
        if (replace) router.replace(hrefFor(target.id), { scroll: false });
        else router.push(hrefFor(target.id), { scroll: false });
    }, [entries, hrefFor, router]);

    // Focus the detail heading once an entry the user opened has rendered.
    useEffect(() => {
        if (current && focusDetail.current === current.id) {
            focusDetail.current = null;
            headingRef.current?.focus();
        }
    }, [current]);

    const resetFilters = () => {
        setRule(null);
        setQuery('');
        setPage(1);
        if (familyId != null) router.replace('/data-checks');
    };

    const onChanged = useCallback(async (message: string) => {
        showSuccessToast(message);
        // The entry leaves this tab, so move on to the next one (or the one before, at the end).
        const next = entries[currentIndex + 1] ?? entries[currentIndex - 1] ?? null;
        await load();
        focusDetail.current = next?.id ?? null;
        router.replace(hrefFor(next?.id ?? null), { scroll: false });
    }, [entries, currentIndex, load, router, hrefFor]);

    // A date fixed in place (#832): re-run the checks, then move on to the next
    // entry, unless the problem is still there or the edit raised a new one for
    // the same person, which the detail then shows instead.
    const onFixed = useCallback(async () => {
        if (!current) return;
        const before = new Set(data.problems.map((p) => p.id));
        const fresh = await load();
        if (!fresh) return;
        // The next entry that's still there: one fix can clear more than one check.
        const after = new Set(fresh.problems.map((p) => p.id));
        const next = [...entries.slice(currentIndex + 1), ...entries.slice(0, currentIndex).reverse()].find((e) => after.has(e.id));
        const same = fresh.problems.find((p) => p.id === current.id);
        const raised = same ? undefined : fresh.problems.find((p) => p.personId === current.personId && !before.has(p.id));
        showSuccessToast(t(same ? 'date_saved_still' : raised ? 'date_saved_new' : 'date_saved_cleared'));
        if (same) return;
        if (raised && activeRule && raised.rule !== activeRule) setRule(null);
        const target = raised?.id ?? next?.id ?? null;
        focusDetail.current = target;
        router.replace(hrefFor(target), { scroll: false });
    }, [current, data.problems, entries, currentIndex, load, t, activeRule, router, hrefFor]);

    const family = familyId != null ? data.families.find((f) => f.Id === familyId) : undefined;
    const familyNames = family
        ? [family.Partner1Id, family.Partner2Id]
            .map((id) => (id != null ? text.byId.get(id) : undefined))
            .filter((p) => p != null)
            .map((p) => displayGivenNames(p!) || personName(p, text.unknown))
            .join(' & ')
        : '';

    // Phones: an entry in the query opens the detail full screen.
    const shown = selectedIndex >= 0;
    const canConfirm = activePermission != null && activePermission !== 'view';
    const canReopen = activePermission === 'owner' || activePermission === 'edit';

    const ruleOptions = [
        { key: 'all', value: null as DataCheckRuleId | null, label: t('all_checks'), meta: filtered.length },
        ...counts.map((c) => ({ key: c.rule, value: c.rule as DataCheckRuleId | null, label: text.ruleName(c.rule), meta: c.count, group: t(KIND_GROUP[c.kind]) })),
    ];
    const clean = DATA_CHECK_RULES.length - counts.length;
    const openTotal = useMemo(() => entriesInTab(data.problems, 'open').length, [data.problems]);
    const confirmedTotal = useMemo(() => entriesInTab(data.problems, 'confirmed').length, [data.problems]);

    if (isMobile) {
        if (shown && current) {
            return (
                <MobileDataCheckEntry key={current.id} entry={current} text={text} position={currentIndex + 1} total={entries.length}
                    onStep={(d) => open(currentIndex + d, true)} onChanged={(m) => void onChanged(m)} onFixed={onFixed}
                    canConfirm={canConfirm} canReopen={canReopen} treeId={activeTreeId} />
            );
        }
        return (
            <MobileDataChecksList
                loading={result == null && !error}
                error={error}
                onRetry={() => void load()}
                tab={tab}
                onTab={(v) => { setTab(v); setRule(null); setPage(1); }}
                query={query}
                onQuery={(q) => { setQuery(q); setPage(1); }}
                rule={activeRule}
                onRule={(v) => { setRule(v); setPage(1); }}
                counts={counts}
                filteredCount={filtered.length}
                clean={clean}
                groups={groups}
                entryCount={entries.length}
                inTabCount={inTab.length}
                page={shownPage}
                pages={pages}
                onPage={setPage}
                hrefFor={hrefFor}
                family={familyId != null ? { label: t('family_filter_label', { names: familyNames || tCommon('unknown') }), onClear: () => { setPage(1); router.replace('/data-checks'); } } : null}
                onReset={resetFilters}
                text={text}
                treeId={activeTreeId}
            />
        );
    }

    return (
        <PageShell busy={result == null && !error}>
            {/* The Tools pages' short band (#59), then the toolbar: the To check / Confirmed
                switch with counts, the search, then the Show select. */}
            <div className="mb-4">
                <CoverBand variant="short" eyebrow={tNav('tools')} title={t('title')}
                    meta={result == null ? t('subtitle') : <>{t('subtitle')} · <span className="tabular-nums">{tNav('data_checks_count', { count: openTotal })}</span></>} />
            </div>
            <div className={cx('flex flex-wrap items-center gap-2.5 mb-4', shown && 'hidden md:flex')}>
                <SegmentedControl
                    aria-label={t('status_label')}
                    value={tab}
                    onChange={(v) => { setTab(v as DataCheckTab); setRule(null); setPage(1); }}
                    options={[
                        { v: 'open', l: result == null ? t('tab_open') : `${t('tab_open')} · ${openTotal}` },
                        { v: 'confirmed', l: result == null ? t('tab_confirmed') : `${t('tab_confirmed')} · ${confirmedTotal}` },
                    ]}
                />
                <Input size="md" type="search" value={query} placeholder={t('search_placeholder')} aria-label={t('search_label')}
                    icon={<Search className="w-4 h-4" aria-hidden="true" />} wrapClassName="w-full md:w-[260px]"
                    onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
                <Select
                    label={t('filter_label')}
                    valueLabel={activeRule ? text.ruleName(activeRule) : t('all_checks')}
                    options={ruleOptions}
                    isSelected={(v) => v === activeRule}
                    onSelect={(v) => { setRule(v); setPage(1); }}
                    footer={tab === 'open' && clean > 0 ? t('clean_checks', { count: clean }) : undefined}
                />
                {familyId != null && (
                    <FilterChip active label={t('family_filter_label', { names: familyNames || tCommon('unknown') })}
                        dismissible dismissLabel={t('remove_family_filter')}
                        onDismiss={() => { setPage(1); router.replace('/data-checks'); }} />
                )}
            </div>

            {error ? (
                <InlineDataError message={error} retryLabel={tCommon('retry')} onRetry={() => void load()} />
            ) : result == null ? (
                <SkeletonList rows={6} />
            ) : inTab.length === 0 ? (
                <EmptyState variant="empty"
                    title={t(tab === 'open' ? 'empty_open_title' : 'empty_confirmed_title')}
                    message={t(tab === 'open' ? 'empty_open_body' : 'empty_confirmed_body')} />
            ) : entries.length === 0 ? (
                <EmptyState variant="filtered" message={t('empty_filtered')} clearLabel={t('clear_filters')} onClear={resetFilters} />
            ) : (
                // Two panels side by side, the list and the entry (locked list-pages board).
                <div className="grid grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[380px_minmax(0,1fr)] gap-5 items-start">
                    <Card pad={false} className={cx('overflow-hidden', shown && 'hidden md:block')}>
                        <DataCheckList groups={kindGroups} selectedId={current?.id ?? null} hrefFor={hrefFor}
                            onOpen={(id) => { focusDetail.current = id; }}
                            page={shownPage} pages={pages} onPage={(p) => setPage(p)} text={text} />
                        {/* "N other checks found nothing" closes the list (#59). */}
                        {tab === 'open' && clean > 0 && (
                            <p className="m-0 border-t border-border px-4 py-2.5 bg-card-alt text-meta text-text-muted">{t('clean_checks', { count: clean })}</p>
                        )}
                    </Card>
                    {current && (
                        <Card pad={false} className={cx('overflow-hidden', !shown && 'hidden md:block')}>
                            <DataCheckDetail ref={headingRef} key={current.id} entry={current} text={text}
                                position={currentIndex + 1} total={entries.length}
                                onStep={(d) => open(currentIndex + d)} onChanged={(m) => void onChanged(m)} onFixed={onFixed}
                                canConfirm={canConfirm} canReopen={canReopen} treeId={activeTreeId} />
                        </Card>
                    )}
                </div>
            )}
        </PageShell>
    );
}
