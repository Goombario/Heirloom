'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { sortableYear } from '@/lib/date-utils';
import { foldForSearch } from '@/lib/utils/search-fold';
import { getInitials } from '@/lib/utils/initials';
import type { FamilyWithSpouseNames } from '@/lib/db/queries/families';
import PersonAvatar from '@/app/components/PersonAvatar';
import {
    MobileListChip, MobileListDivider, MobileListFilters, MobileListMeta, MobileListPager, MobileRow,
    SortSheet, StatusMark,
} from '@/app/components/ui';
import {
    coupleName, endedYear, familyDurationYears, isActive, sortSurname,
    type CoupleName, type FamilyFilterKey, type FamilySortKey,
} from './familyList';

/*
 * The phone families list (#1064), from the locked mockup, on the people list standard
 * (design-system.md → Mobile → List pages). FamiliesPageClient keeps the filter, sort
 * and page state for both layouts; these parts only draw the phone one.
 */

const town = (place: string | null | undefined) => place?.split(',')[0]?.trim() || '';

/** The mockup's chip order: the three kinds, then the three states. */
const CHIPS: { key: FamilyFilterKey; labelKey: string }[] = [
    { key: 'marriages', labelKey: 'filter_marriages' },
    { key: 'civil', labelKey: 'filter_civil' },
    { key: 'commonlaw', labelKey: 'filter_commonlaw' },
    { key: 'active', labelKey: 'filter_active' },
    { key: 'ended-death', labelKey: 'filter_ended_death' },
    { key: 'ended-divorce', labelKey: 'filter_ended_divorce' },
];

interface MobileFamiliesFiltersProps {
    query: string;
    onQuery: (value: string) => void;
    /** One chip on at a time; null means none, which is all. */
    filter: FamilyFilterKey | null;
    onFilter: (key: FamilyFilterKey | null) => void;
}

/** The filter field and the six single-select chips under the header. */
export function MobileFamiliesFilters({ query, onQuery, filter, onFilter }: MobileFamiliesFiltersProps) {
    const t = useTranslations('families');
    const tc = useTranslations('common');
    return (
        <MobileListFilters value={query} onChange={onQuery} placeholder={t('list_filter_placeholder')}>
            {CHIPS.map(({ key, labelKey }) => {
                const label = t(labelKey);
                const on = filter === key;
                return (
                    <MobileListChip
                        key={key}
                        label={label}
                        active={on}
                        dismissible
                        dismissLabel={tc('clear_filter_named', { name: label })}
                        onClick={() => onFilter(on ? null : key)}
                        onDismiss={() => onFilter(null)}
                    />
                );
            })}
        </MobileListFilters>
    );
}

interface MobileFamiliesRowsProps {
    /** This page's families, already filtered and sorted. */
    rows: FamilyWithSpouseNames[];
    count: string;
    treeId: number | null;
    column: FamilySortKey;
    ascending: boolean;
    onSort: (column: FamilySortKey, ascending: boolean) => void;
    page: number;
    pages: number;
    onPage: (page: number) => void;
}

/** The count and sort row, the rows with dividers that follow the sort, and the pager. */
export function MobileFamiliesRows({ rows, count, treeId, column, ascending, onSort, page, pages, onPage }: MobileFamiliesRowsProps) {
    const tp = useTranslations('people');
    const [sortOpen, setSortOpen] = useState(false);
    const columns = useSortColumns();
    const current = columns.find((c) => c.key === column) ?? columns[0];
    const divider = useDivider(column);

    let last: string | null = null;
    const items: React.ReactNode[] = [];
    rows.forEach((family, i) => {
        const group = divider(family);
        const opensGroup = group !== null && group.key !== last;
        if (opensGroup) {
            items.push(<MobileListDivider key={`d-${group.key}-${i}`}>{group.cased ? <span className="normal-case">{group.label}</span> : group.label}</MobileListDivider>);
            last = group.key;
        }
        items.push(<FamilyListRow key={family.Id} family={family} treeId={treeId} column={column} divided={i > 0 && !opensGroup} />);
    });

    return (
        <div className="md:hidden">
            <MobileListMeta
                count={count}
                sortLabel={tp('sort_meta', { col: current.label, order: current.orders[ascending ? 0 : 1] })}
                onSort={() => setSortOpen(true)}
            />
            {items}
            <MobileListPager page={page} pages={pages} onPage={onPage} />
            <SortSheet
                open={sortOpen}
                onClose={() => setSortOpen(false)}
                title={tp('sort_title')}
                columns={columns}
                column={column}
                ascending={ascending}
                onChange={(key, asc) => onSort(key as FamilySortKey, asc)}
            />
        </div>
    );
}

/** The seven desktop columns, each with its own order words. */
function useSortColumns() {
    const t = useTranslations('families');
    const tp = useTranslations('people');
    const az: [string, string] = [tp('order_az'), tp('order_za')];
    const years: [string, string] = [tp('order_oldest'), tp('order_newest')];
    return [
        { key: 'partner', label: t('list_sort_partner'), hint: t('list_sort_hint_partner'), orders: az },
        { key: 'type', label: t('col_type'), hint: t('list_sort_hint_type'), orders: az },
        { key: 'began', label: t('col_began'), hint: t('list_sort_hint_began'), orders: years },
        { key: 'ended', label: t('col_ended'), hint: t('list_sort_hint_ended'), orders: years },
        { key: 'children', label: t('col_children'), hint: t('list_sort_hint_children'), orders: [t('list_order_fewest'), tp('order_most')] as [string, string] },
        { key: 'place', label: t('col_place'), hint: t('list_sort_hint_place'), orders: az },
        { key: 'sources', label: t('col_sources'), hint: tp('sort_hint_sources'), orders: [tp('order_least'), tp('order_most')] as [string, string] },
    ] satisfies { key: FamilySortKey; label: string; hint: string; orders: [string, string] }[];
}

/** What a row's divider says under this sort: a letter, a kind, a decade, a town, or nothing. */
function useDivider(column: FamilySortKey) {
    const t = useTranslations('families');
    const tp = useTranslations('people');
    /** `cased`: the label keeps its own case ("1890s", not the eyebrow's "1890S"). */
    return (f: FamilyWithSpouseNames): { key: string; label: string; cased?: boolean } | null => {
        const decade = (year: number | null, none: string) => {
            if (year === null) return { key: '-', label: none };
            const d = Math.floor(year / 10) * 10;
            return { key: String(d), label: tp('div_decade', { decade: d }), cased: true };
        };
        switch (column) {
            case 'partner': {
                const letter = foldForSearch(sortSurname(f)).charAt(0).toLocaleUpperCase();
                return letter ? { key: letter, label: letter } : { key: '-', label: tp('div_no_surname') };
            }
            case 'type': {
                const type = f.Type ?? 'Marriage';
                const label = type === 'Marriage' ? t('filter_marriages')
                    : type === 'Civil union' ? t('filter_civil')
                    : type === 'Common-law' ? t('filter_commonlaw')
                    : type === 'Other' ? t('list_div_other')
                    : t('list_div_unknown_type');
                return { key: type, label };
            }
            case 'began': return decade(sortableYear(f.MarriageDate), t('list_div_no_start'));
            case 'ended':
                return isActive(f) ? { key: 'active', label: t('list_div_still_active') } : decade(endedYear(f), t('list_div_no_end'));
            case 'place': {
                const at = town(f.MarriagePlace);
                return at ? { key: foldForSearch(at), label: at } : { key: '-', label: t('list_div_no_place') };
            }
            default: return null;
        }
    };
}

/** The couple's name, surnames the heavier half (#426), wrapping rather than cutting a surname. */
function RowName({ name, fallback }: { name: CoupleName; fallback: string }) {
    const { partners, shared } = name;
    if (partners.length === 0) return <span className="italic text-text-muted">{fallback}</span>;
    const surname = (s: string) => <span className="font-semibold text-text">{s}</span>;
    const given = (s: string) => <span className="text-text-secondary">{s || '?'}</span>;
    if (shared) {
        return <>{given(partners[0].given)} &amp; {given(partners[1].given)} {surname(partners[0].surname)}</>;
    }
    return (
        <>
            {partners.map((p, i) => (
                <React.Fragment key={i}>
                    {i > 0 && ' & '}
                    {p.given && given(p.given)}
                    {p.given && p.surname && ' '}
                    {p.surname && surname(p.surname)}
                    {!p.given && !p.surname && given('')}
                </React.Fragment>
            ))}
        </>
    );
}

/** A partner's 34px portrait, ringed in the page colour so the pair overlaps cleanly. */
function PairAvatar({ name, sex, mediaId, focalX, focalY, focalRadius, treeId }: {
    name: string | null;
    sex: string | null;
    mediaId: number | null;
    focalX: number | null;
    focalY: number | null;
    focalRadius: number | null;
    treeId: number | null;
}) {
    if (!name) {
        // No partner recorded: a hatched "?" holds the place.
        return (
            <span
                aria-hidden="true"
                className="grid place-items-center w-[38px] h-[38px] rounded-full border-2 border-surface text-meta font-semibold text-text-muted bg-[repeating-linear-gradient(135deg,var(--color-surface-2)_0_5px,var(--color-border)_5px_10px)]"
            >
                ?
            </span>
        );
    }
    const parts = name.trim().split(/\s+/);
    return (
        <PersonAvatar
            as="span"
            mediaId={mediaId}
            treeId={treeId}
            name={name}
            initials={getInitials(parts[0] ?? '', parts[parts.length - 1] ?? '')}
            sex={sex}
            size={38}
            focalX={focalX}
            focalY={focalY}
            focalRadius={focalRadius}
            ringClassName="border-2 border-surface"
        />
    );
}

/** One tap opens the family page. No ↗: every row on a list page opens a page. */
function FamilyListRow({ family: f, treeId, column, divided }: {
    family: FamilyWithSpouseNames;
    treeId: number | null;
    column: FamilySortKey;
    divided: boolean;
}) {
    const t = useTranslations('families');
    const tp = useTranslations('people');
    const name = coupleName(f);
    const fallback = t('partnership_fallback', { id: f.Id });
    const active = isActive(f);
    const type = f.Type ?? 'Marriage';
    const { startYear, endYear } = familyDurationYears(f, active, new Date().getFullYear());

    const parts: React.ReactNode[] = [];
    // Marriage is the default kind and says nothing; the others name themselves.
    if (type !== 'Marriage') {
        parts.push(
            <span className="text-text-secondary">
                {type === 'Civil union' ? t('ftype_civil_union') : type === 'Common-law' ? t('ftype_commonlaw') : t('subtitle_partnership')}
            </span>,
        );
    }
    if (active) {
        if (startYear) parts.push(<span className="date-mono date-muted">{type === 'Marriage' ? t('married_year', { year: startYear }) : startYear}</span>);
        parts.push(
            <span className="inline-flex items-center gap-1 text-text-secondary">
                <StatusMark status="living" />{t('active_pill')}
            </span>,
        );
    } else if (startYear || endYear) {
        parts.push(<span className="date-mono date-muted">{`${startYear || '?'}–${endYear || '?'}`}</span>);
    } else {
        parts.push(tp('no_dates'));
    }
    // Only a divorce, separation or annulment adds words: the years already say it ended.
    if (f.EndedReason === 'Divorce') parts.push(t('list_divorced'));
    else if (f.EndedReason === 'Separation') parts.push(t('list_separated'));
    else if (f.EndedReason === 'Annulment') parts.push(t('list_annulled'));

    const children = f.childCount > 0 ? t('child_count', { count: f.childCount }) : t('list_no_children');
    if (column === 'sources') {
        if ((f.TotalFacts ?? 0) > 0) parts.push(tp('sourced_count', { sourced: f.SourcedFacts ?? 0, total: f.TotalFacts ?? 0 }));
    } else if (column === 'children') {
        // Died young only here: everywhere else it would crowd the line.
        parts.push(f.youngDeathCount > 0 ? t('list_children_died_young', { children, count: f.youngDeathCount }) : children);
    } else {
        parts.push(children);
        if (column === 'place' && f.MarriagePlace) parts.push(town(f.MarriagePlace));
    }

    return (
        <MobileRow
            href={`/families/view?id=${f.Id}`}
            divided={divided}
            className="min-h-[62px] py-2.5"
            lead={(
                <span className="flex shrink-0 w-[62px] [&>*+*]:-ml-3.5">
                    <PairAvatar name={f.husbandName} sex={f.partner1Sex} mediaId={f.husbandMediaId} focalX={f.husbandFocalX} focalY={f.husbandFocalY} focalRadius={f.husbandFocalRadius} treeId={treeId} />
                    <PairAvatar name={f.wifeName} sex={f.partner2Sex} mediaId={f.wifeMediaId} focalX={f.wifeFocalX} focalY={f.wifeFocalY} focalRadius={f.wifeFocalRadius} treeId={treeId} />
                </span>
            )}
            label={(
                <span className="block serif text-md break-words [text-wrap:balance]">
                    <RowName name={name} fallback={fallback} />
                </span>
            )}
            sub={(
                <span className="block truncate">
                    {parts.map((part, i) => (
                        <React.Fragment key={i}>{i > 0 && ' · '}{part}</React.Fragment>
                    ))}
                </span>
            )}
        />
    );
}
