'use client';

import React, { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { livingStatus } from '@/lib/living';
import { formatYearOrEmpty, sortableYear } from '@/lib/date-utils';
import { foldForSearch } from '@/lib/utils/search-fold';
import { displayFirstName, displayFullName, displayGivenNames } from '@/lib/utils/names';
import { getInitials } from '@/lib/utils/initials';
import type { PersonWithParentFamily } from '@/lib/db/queries/people';
import PersonAvatar from '@/app/components/PersonAvatar';
import {
    ChoiceSheet, Lifespan, MobileListChip, MobileListDivider, MobileListFilters, MobileListMeta,
    MobileListPager, MobileRow, SortSheet, StatusMark,
} from '@/app/components/ui';
import type { TriState } from './peopleFilters';

/*
 * The phone people list (#1063), from the locked mockup: the standard every mobile list
 * page follows (design-system.md → Mobile → List pages). PeoplePageClient keeps the
 * filter, sort and page state for both layouts; these parts only draw the phone one.
 */

export type PeopleSortColumn = 'name' | 'birth' | 'death' | 'place' | 'sources' | 'updated';

const town = (place: string | null | undefined) => place?.split(',')[0]?.trim() || '';

const parentsOf = (p: PersonWithParentFamily) => [
    (p.FatherFirstName || p.FatherLastName) && `${p.FatherFirstName ?? ''} ${p.FatherLastName ?? ''}`.trim(),
    (p.MotherFirstName || p.MotherLastName) && `${p.MotherFirstName ?? ''} ${p.MotherLastName ?? ''}`.trim(),
].filter(Boolean).join(' & ');

interface TriChip {
    state: TriState;
    onChange: (next: TriState) => void;
    /** The chip's word when off or on ("Has parents"), and when negated ("No parents"). */
    yes: string;
    no: string;
    /** Off has its own word when "yes" alone would mislead ("Living or deceased"). */
    off?: string;
}

interface MobilePeopleFiltersProps {
    query: string;
    onQuery: (value: string) => void;
    /** The Likely duplicates chip, shown while a home suggestion's filter is on. */
    duplicates: boolean;
    onClearDuplicates: () => void;
    surname: string | null;
    onSurname: (name: string | null) => void;
    /** Every surname with its count, most common first. */
    surnames: [string, number][];
    /** The active sex chip's words ("Sex: Male"), or null when off. */
    sexLabel: string | null;
    /** False hides the chip: a one-option filter filters nothing. */
    sexAvailable: boolean;
    onCycleSex: () => void;
    onClearSex: () => void;
    tri: TriChip[];
    anyFilter: boolean;
    onClearAll: () => void;
}

/** The filter field and chips under the header, and the Surname sheet the chip opens. */
export function MobilePeopleFilters(p: MobilePeopleFiltersProps) {
    const t = useTranslations('people');
    const tc = useTranslations('common');
    const [surnameSheet, setSurnameSheet] = useState(false);
    const clear = (name: string) => tc('clear_filter_named', { name });
    const surnameLabel = p.surname ? t('filter_surname_active', { name: p.surname }) : t('filter_surname');
    const sexLabel = p.sexLabel ?? t('filter_sex');
    return (
        <>
            <MobileListFilters value={p.query} onChange={p.onQuery} placeholder={t('filter_placeholder')}>
                {p.duplicates && (
                    <MobileListChip
                        label={t('filter_duplicates')}
                        active
                        dismissible
                        dismissLabel={clear(t('filter_duplicates'))}
                        onClick={p.onClearDuplicates}
                        onDismiss={p.onClearDuplicates}
                    />
                )}
                <MobileListChip
                    label={surnameLabel}
                    active={p.surname !== null}
                    dismissible
                    dismissLabel={clear(surnameLabel)}
                    aria-haspopup={p.surname === null ? 'dialog' : undefined}
                    onClick={() => (p.surname ? p.onSurname(null) : setSurnameSheet(true))}
                    onDismiss={() => p.onSurname(null)}
                />
                {p.sexAvailable && (
                    <MobileListChip
                        label={sexLabel}
                        active={p.sexLabel !== null}
                        dismissible
                        dismissLabel={clear(sexLabel)}
                        onClick={p.onCycleSex}
                        onDismiss={p.onClearSex}
                    />
                )}
                {p.tri.map((c) => {
                    const label = c.state === 'no' ? c.no : c.state === 'yes' ? c.yes : (c.off ?? c.yes);
                    return (
                        <MobileListChip
                            key={c.yes}
                            label={label}
                            active={c.state !== 'off'}
                            dismissible
                            dismissLabel={clear(label)}
                            onClick={() => c.onChange(c.state === 'off' ? 'yes' : c.state === 'yes' ? 'no' : 'off')}
                            onDismiss={() => c.onChange('off')}
                        />
                    );
                })}
                {p.anyFilter && (
                    <MobileListChip
                        label={t('clear_all')}
                        onClick={p.onClearAll}
                        className="!border-transparent !bg-transparent !text-link font-semibold"
                    />
                )}
            </MobileListFilters>
            <ChoiceSheet
                open={surnameSheet}
                onClose={() => setSurnameSheet(false)}
                title={t('filter_surname')}
                searchPlaceholder={t('surname_find')}
                heading={p.surnames.length > 0 ? t('surname_most_common') : undefined}
                options={p.surnames.map(([name, count]) => ({ value: name, label: name, count }))}
                onPick={(name) => { setSurnameSheet(false); p.onSurname(name); }}
                emptyLabel={p.surnames.length > 0 ? t('surname_none_match') : t('no_surnames')}
            />
        </>
    );
}

interface MobilePeopleRowsProps {
    /** This page's people, already filtered and sorted. */
    rows: PersonWithParentFamily[];
    count: string;
    treeId: number | null;
    column: PeopleSortColumn;
    ascending: boolean;
    onSort: (column: PeopleSortColumn, ascending: boolean) => void;
    /** Likely duplicates mode: the server's order, grouped by match, with each row's parents. */
    duplicates: boolean;
    /** Each likely duplicate's group (#822), so a respelled match shares its divider. */
    duplicateGroup?: ReadonlyMap<number, number>;
    page: number;
    pages: number;
    onPage: (page: number) => void;
}

/** The count and sort row, the rows with dividers that follow the sort, and the pager. */
export function MobilePeopleRows({ rows, count, treeId, column, ascending, onSort, duplicates, duplicateGroup, page, pages, onPage }: MobilePeopleRowsProps) {
    const t = useTranslations('people');
    const [sortOpen, setSortOpen] = useState(false);
    const columns = useSortColumns();
    const current = columns.find((c) => c.key === column) ?? columns[0];
    const divider = useDivider(column, duplicates, duplicateGroup);

    let last: string | null = null;
    const items: React.ReactNode[] = [];
    rows.forEach((person, i) => {
        const group = divider(person);
        const opensGroup = group !== null && group.key !== last;
        if (opensGroup) {
            items.push(<MobileListDivider key={`d-${group.key}-${i}`}>{group.cased ? <span className="normal-case">{group.label}</span> : group.label}</MobileListDivider>);
            last = group.key;
        }
        items.push(
            <PersonListRow
                key={person.Id}
                person={person}
                treeId={treeId}
                column={column}
                duplicates={duplicates}
                divided={i > 0 && !opensGroup}
            />,
        );
    });

    return (
        <div className="md:hidden">
            <MobileListMeta
                count={count}
                sortLabel={duplicates ? undefined : t('sort_meta', { col: current.label, order: current.orders[ascending ? 0 : 1] })}
                onSort={() => setSortOpen(true)}
            />
            {items}
            <MobileListPager page={page} pages={pages} onPage={onPage} />
            <SortSheet
                open={sortOpen}
                onClose={() => setSortOpen(false)}
                title={t('sort_title')}
                columns={columns}
                column={column}
                ascending={ascending}
                // Recently updated starts newest first: that is what the word promises.
                onChange={(key, asc) => onSort(key as PeopleSortColumn, key !== column && key === 'updated' ? false : asc)}
            />
        </div>
    );
}

function useSortColumns() {
    const t = useTranslations('people');
    const az: [string, string] = [t('order_az'), t('order_za')];
    const years: [string, string] = [t('order_oldest'), t('order_newest')];
    return [
        { key: 'name', label: t('col_name_label'), hint: t('sort_hint_name'), orders: az },
        { key: 'birth', label: t('col_born'), hint: t('sort_hint_birth'), orders: years },
        { key: 'death', label: t('col_died'), hint: t('sort_hint_death'), orders: years },
        { key: 'place', label: t('col_birthplace'), hint: t('sort_hint_place'), orders: az },
        { key: 'sources', label: t('col_sources'), hint: t('sort_hint_sources'), orders: [t('order_least'), t('order_most')] as [string, string] },
        { key: 'updated', label: t('sort_recently_updated'), hint: t('sort_hint_updated'), orders: years },
    ] satisfies { key: PeopleSortColumn; label: string; hint: string; orders: [string, string] }[];
}

/** What a row's divider says under this sort: a letter, a decade, a town, or nothing. */
function useDivider(column: PeopleSortColumn, duplicates: boolean, duplicateGroup?: ReadonlyMap<number, number>) {
    const t = useTranslations('people');
    /** `cased`: the label keeps its own case ("1890s", not the eyebrow's "1890S"). */
    return (p: PersonWithParentFamily): { key: string; label: string; cased?: boolean } | null => {
        if (duplicates) {
            // The server lists each group of likely matches as a run, labelled by
            // the name of its first row; a respelled match stays in its group.
            const name = displayFullName(p) || t('unnamed');
            const group = duplicateGroup?.get(p.Id);
            return { key: group !== undefined ? `g${group}` : foldForSearch(`${p.FirstName ?? ''} ${p.LastName ?? ''}`.trim()), label: name };
        }
        const decade = (date: string | null | undefined, none: string) => {
            const y = sortableYear(date);
            if (y === null) return { key: '-', label: none };
            const d = Math.floor(y / 10) * 10;
            return { key: String(d), label: t('div_decade', { decade: d }), cased: true };
        };
        switch (column) {
            case 'name': {
                const letter = foldForSearch(p.LastName?.trim() ?? '').charAt(0).toLocaleUpperCase();
                return letter ? { key: letter, label: letter } : { key: '-', label: t('div_no_surname') };
            }
            case 'birth': return decade(p.BirthDate, t('div_no_birth'));
            case 'death': return decade(p.DeathDate, t('div_no_death'));
            case 'place': {
                const at = town(p.BirthPlace);
                return at ? { key: foldForSearch(at), label: at } : { key: '-', label: t('div_no_place') };
            }
            default: return null;
        }
    };
}

/**
 * Surname and given names in natural order, the surname the heavier half (#426).
 */
function RowName({ person, unnamed }: { person: PersonWithParentFamily; unnamed: string }) {
    const given = displayGivenNames(person);
    const surname = person.LastName;
    if (!given && !surname) return <span className="italic text-text-muted">{unnamed}</span>;
    return (
        <>
            {given && <span className="text-text-secondary">{given}</span>}
            {given && surname && ' '}
            {surname && <span className="font-semibold text-text">{surname}</span>}
        </>
    );
}

/** One tap opens the person. No ↗: every row on a list page opens a page. */
function PersonListRow({ person, treeId, column, duplicates, divided }: {
    person: PersonWithParentFamily;
    treeId: number | null;
    column: PeopleSortColumn;
    duplicates: boolean;
    divided: boolean;
}) {
    const t = useTranslations('people');
    const tc = useTranslations('common');
    const locale = useLocale();
    const status = livingStatus(person);
    const fullName = displayFullName(person) || t('unnamed');

    // Living people read "b. 1990 · ● Living"; everyone else gets the lifespan alone.
    const living = status === 'living';
    const years = (
        <Lifespan
            birth={person.BirthDate}
            death={person.DeathDate}
            status={living ? undefined : status}
        />
    );
    const hasYears = !!formatYearOrEmpty(person.BirthDate ?? null) || !!formatYearOrEmpty(person.DeathDate ?? null);
    const parts: React.ReactNode[] = [];
    if (hasYears) parts.push(years);
    if (living) {
        parts.push(
            <span className="inline-flex items-center gap-1 text-text-secondary">
                <StatusMark status="living" />{tc('living')}
            </span>,
        );
    }
    if (!hasYears && !living) parts.push(t('no_dates'));

    if (duplicates) {
        const parents = parentsOf(person);
        parts.push(parents ? t('dup_parents', { names: parents }) : t('filter_no_parents'));
    } else if (column === 'sources') {
        if ((person.TotalFacts ?? 0) > 0) parts.push(t('sourced_count', { sourced: person.SourcedFacts ?? 0, total: person.TotalFacts ?? 0 }));
    } else if (column === 'updated') {
        if (person.UpdatedAt) parts.push(t('updated_ago', { when: relativeDay(person.UpdatedAt, locale) }));
    } else if (person.BirthPlace) {
        parts.push(town(person.BirthPlace));
    }

    return (
        <MobileRow
            href={`/people/view?id=${person.Id}`}
            divided={divided}
            className="min-h-[62px] py-2.5"
            lead={(
                <PersonAvatar
                    as="span"
                    mediaId={person.PrimaryMediaId}
                    treeId={treeId}
                    name={String(fullName)}
                    initials={getInitials(displayFirstName(person), person.LastName)}
                    sex={person.Sex}
                    size={40}
                    focalX={person.FocalX}
                    focalY={person.FocalY}
                    focalRadius={person.FocalRadius}
                />
            )}
            label={(
                <span className="block truncate serif text-md">
                    <RowName person={person} unnamed={t('unnamed')} />
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

/** "today", "3 days ago", "2 months ago", "last year", in the reader's language. */
function relativeDay(iso: string, locale: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return iso;
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
    if (days < 30) return rtf.format(-days, 'day');
    if (days < 365) return rtf.format(-Math.round(days / 30), 'month');
    return rtf.format(-Math.round(days / 365), 'year');
}
