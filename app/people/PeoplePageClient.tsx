'use client';

import { peopleListKey } from './peopleListKey';
import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { livingStatus } from '@/lib/living';
import { compareText } from '@/lib/collation';
import { Button, CopperPill, DataTable, Pagination, EmptyState, MobileListHeader, PageShell, type Column } from '@/app/components/ui';
import { Plus } from '@/lib/icons';
import type { PersonWithParentFamily } from '@/lib/db/queries/people';
import { formatDateForDisplay } from '@/lib/date-utils';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { useTree } from '@/app/contexts/TreeContext';
import PersonAvatar from '@/app/components/PersonAvatar';
import { FilterChip } from '@/app/components/ui';
import SearchBar from '@/app/components/SearchBar';
import { SkeletonList } from '@/app/components/SkeletonLoader';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import { getInitials } from '@/lib/utils/initials';
import { displayFirstName, displayGivenNames, displayFullName } from '@/lib/utils/names';
import { MobilePeopleFilters, MobilePeopleRows, type PeopleSortColumn } from './MobilePeopleList';
import { getDataClient } from '@/lib/data';
import { prefetchPerson, cachePersonSummaries } from '@/app/people/view/personCache';
import { useCachedResource } from '@/app/components/useCachedResource';
import { errorToastKey } from '@/lib/utils/data-error';
import { InlineDataError } from '@/app/components/ui';
import { useErrorToast } from '@/app/components/useErrorToast';
import type { ListPeopleResult } from '@/lib/services/people';
import { cycleTri, flagFromUrlFilter, matchesSexBucket, matchesTri, sexBucketsPresent, type SexBucket, type TriState } from './peopleFilters';
import { foldForSearch } from '@/lib/utils/search-fold';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { AddPersonSheet } from './AddPersonSheet';

type SortColumn = PeopleSortColumn;
type SortDirection = 'asc' | 'desc';

const ITEMS_PER_PAGE = 50;

/**
 * Surname and given names, told apart at a glance (#426). The full name used to
 * render as one undifferentiated string, and the surname is what the eye is
 * actually hunting for in this list — it is also what the surname filter chip and
 * the grouping popover key on, so making it the dominant half reinforces those
 * rather than competing with them.
 *
 * Weight AND colour, never colour alone. Both are token-backed (`text-text` /
 * `text-text-secondary`) so the split survives theming and the
 * `ds/no-inline-static-literal` rule.
 */
function SplitName({ person, unnamed, surnameFirst }: {
    person: PersonWithParentFamily;
    unnamed: string;
    /** Table order is "Surname, Given"; otherwise natural order. */
    surnameFirst?: boolean;
}) {
    const given = displayGivenNames(person);
    const surname = person.LastName;
    if (!surname) return <>{given || unnamed}</>;
    const surnameEl = <span className="font-semibold text-text">{surname}</span>;
    const givenEl = given ? <span className="font-normal text-text-secondary">{given}</span> : null;
    return surnameFirst
        ? <>{surnameEl}{givenEl && <>, {givenEl}</>}</>
        : <>{givenEl}{givenEl && ' '}{surnameEl}</>;
}

/**
 * A chip for an invertible filter: off → matches → does not match → off.
 * The negated state is signalled by its own label text plus a slash glyph, never
 * by colour alone (the active/inactive pill colours are the only colour cue and
 * they do not distinguish "matches" from "does not match").
 */
function TriFilterChip({ state, onChange, labels, clearLabel }: {
    state: TriState;
    onChange: (next: TriState) => void;
    labels: Record<TriState, string>;
    clearLabel: (name: string) => string;
}) {
    const text = labels[state];
    // The leading Plus reads as "add this filter", so it belongs only to the unset
    // state; the slash marks the negated one. Both are decoration, kept out of the
    // accessible name.
    const icon = state === 'off' ? <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        : state === 'no' ? <span aria-hidden="true">⊘</span> : undefined;
    return (
        <FilterChip
            label={text}
            icon={icon}
            active={state !== 'off'}
            dismissible
            dismissLabel={clearLabel(text)}
            onClick={() => onChange(cycleTri(state))}
            onDismiss={() => onChange('off')}
        />
    );
}


export default function PeoplePageClient({
    initialPeople,
}: {
    initialPeople: ListPeopleResult | null;
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const t = useTranslations('people');
    const locale = useLocale();
    const tCommon = useTranslations('common');
    const { activeTreeId, activePermission, currentUserId } = useTree();
    const { language } = useLanguage();
    const dateWords = useDateQualifierWords();
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [sortColumn, setSortColumn] = useState<SortColumn>('name');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [sexFilter, setSexFilter] = useState<SexBucket | null>(null);
    const [hasParentsFilter, setHasParentsFilter] = useState<TriState>('off');
    // A home suggestion's people, which only the server can find (#794).
    const urlFlag = flagFromUrlFilter(searchParams.get('filter'));
    const [flag, setFlag] = useState(urlFlag);
    const [hasChildrenFilter, setHasChildrenFilter] = useState<TriState>('off');
    const [hasPhotoFilter, setHasPhotoFilter] = useState<TriState>('off');
    // Living and deceased were two chips asking one question. One tri-state chip:
    // off = everyone, yes = living, no = deceased.
    const [livingFilter, setLivingFilter] = useState<TriState>('off');
    const [surnameFilter, setSurnameFilter] = useState<string | null>(null);
    const [showSurnamePicker, setShowSurnamePicker] = useState(false);
    const [surnamePickerPos, setSurnamePickerPos] = useState<{ top: number; left: number } | null>(null);
    const surnameChipRef = useRef<HTMLDivElement>(null);

    function toggleSurnamePicker() {
        if (surnameFilter) { setSurnameFilter(null); return; }
        if (showSurnamePicker) { setShowSurnamePicker(false); return; }
        const rect = surnameChipRef.current?.getBoundingClientRect();
        if (rect) setSurnamePickerPos({ top: rect.bottom + 4, left: rect.left });
        setShowSurnamePicker(true);
    }

    const canEdit = activePermission !== 'view';
    const { redirectIfUnauthorized } = useErrorToast();

    // The phone's Add person is a sheet over this list (#1065). `?add=1` opens it, which
    // is where /people/new and the home page send a phone; a wider screen gets the page.
    const [adding, setAdding] = useState(false);
    const wantsAdd = searchParams.get('add') === '1';
    useEffect(() => {
        if (!wantsAdd) return;
        if (!window.matchMedia('(max-width: 767px)').matches) { router.replace('/people/new'); return; }
        if (canEdit) setAdding(true);
        const rest = new URLSearchParams(searchParams.toString());
        rest.delete('add');
        router.replace(rest.size > 0 ? `/people?${rest}` : '/people', { scroll: false });
    }, [wantsAdd, canEdit, router, searchParams]);

    const { data, loading, error, retry } = useCachedResource(
        currentUserId === null ? null : peopleListKey(activeTreeId),
        async () => {
            const client = await getDataClient();
            return await client.people.list({ treeId: activeTreeId });
        },
        // The SSR seed is always the user's default tree (TreeContext starts at
        // activeTreeId=null); a restored non-default selection misses this key.
        initialPeople !== null
            ? { key: peopleListKey(null), data: initialPeople }
            : undefined,
    );

    const flagged = useCachedResource(
        currentUserId === null || flag === null ? null : `people:flagged:${flag}:tree=${activeTreeId ?? 'default'}`,
        async () => {
            const client = await getDataClient();
            return await client.people.listFlagged(flag!, activeTreeId);
        },
    );
    // Review order: each likely duplicate beside its match (#794), and the
    // group each one is in, for the phone list's dividers (#822).
    const flaggedRank = useMemo(
        () => flag && flagged.data ? new Map(flagged.data.flat().map((id, i) => [id, i])) : null,
        [flag, flagged.data],
    );
    const duplicateGroup = useMemo(
        () => flag === 'duplicates' && flagged.data ? new Map(flagged.data.flatMap((group, g) => group.map(id => [id, g] as const))) : undefined,
        [flag, flagged.data],
    );
    const listError = error ?? (flag ? flagged.error : null);

    useEffect(() => {
        if (listError) redirectIfUnauthorized(listError);
    }, [listError, redirectIfUnauthorized]);
    const people = useMemo(() => data?.people ?? [], [data]);
    // Skeleton-first, and treat "user still resolving" (currentUserId === null in
    // hosted mode, before /api/users/me resolves) as loading — otherwise the
    // null cache key makes useCachedResource report loading=false and the page
    // paints its empty "No people yet" state into the prerendered HTML.
    const phase = useLoadPhase(currentUserId === null || loading || (flag !== null && flagged.loading), { delay: 0 });

    useDocumentTitle(t('title'));
    useEffect(() => {
        setFlag(urlFlag);
    }, [urlFlag]);
    // Index each loaded row as an identity summary so a tap-through to a person
    // paints the hero instantly (no blank) while the full record loads (#2).
    useEffect(() => { cachePersonSummaries(people, activeTreeId); }, [people, activeTreeId]);

    useEffect(() => {
        // Reset to the first page whenever a filter/sort/search input changes, or
        // the active tree switches (a smaller tree would otherwise strand the user
        // on a now-out-of-range page showing an empty list).
        setCurrentPage(1);
    }, [searchQuery, sortColumn, sortDirection, sexFilter, hasParentsFilter, hasChildrenFilter, surnameFilter, hasPhotoFilter, livingFilter, flag, activeTreeId]);

    const blankLast = (a: string, b: string): number | null => {
        if (!a && !b) return 0;
        if (!a) return 1;
        if (!b) return -1;
        return null;
    };

    // Only offer buckets that match someone — a tree with no unrecorded-sex people
    // should not have a dead 'X' step in its cycle. A selection carried over from
    // another tree that has no such people is ignored rather than left stranding
    // the list on an empty result.
    const availableSexes = useMemo(() => sexBucketsPresent(people), [people]);
    const effectiveSex = sexFilter && availableSexes.includes(sexFilter) ? sexFilter : null;

    const filtered = useMemo(() => {
        let r = [...people];

        if (flag) r = flaggedRank ? r.filter(p => flaggedRank.has(p.Id)) : [];

        if (searchQuery.trim()) {
            const words = foldForSearch(searchQuery).split(/\s+/);
            r = r.filter(p => {
                const haystack = foldForSearch([p.FirstName, p.LastName, p.AllNames, p.BirthPlace, p.DeathPlace, p.GedcomId]
                    .filter(Boolean)
                    .join(' '));
                return words.every(w => haystack.includes(w));
            });
        }

        // One classifier for the chip cycle and the predicate, so the label can never
        // name a bucket the filter does not actually apply (#427).
        if (effectiveSex) r = r.filter(p => matchesSexBucket(effectiveSex, p.Sex));

        // Tri-state: 'off' matches everyone, 'yes' the predicate, 'no' its negation.
        // The parent test includes surnames: a GEDCOM parent recorded as `/Smith/`
        // has no first name, and under negation that would positively assert the
        // child has no parents rather than merely omitting them.
        r = r.filter(p =>
            matchesTri(hasParentsFilter, !!(p.FatherFirstName || p.FatherLastName || p.MotherFirstName || p.MotherLastName))
            && matchesTri(hasChildrenFilter, (p.ChildrenCount ?? 0) > 0)
            && matchesTri(hasPhotoFilter, !!p.PrimaryMediaId)
            && matchesTri(livingFilter, livingStatus(p) !== 'deceased'));

        if (surnameFilter) r = r.filter(p => (p.LastName ?? '').toLowerCase() === surnameFilter.toLowerCase());

        r.sort((a, b) => {
            let cmp = 0;
            switch (sortColumn) {
                case 'name': {
                    // Likely duplicates keep the server's pairing order (#794).
                    if (flaggedRank && flag === 'duplicates') {
                        cmp = flaggedRank.get(a.Id)! - flaggedRank.get(b.Id)!;
                        break;
                    }
                    const ln = blankLast(a.LastName?.toLowerCase() || '', b.LastName?.toLowerCase() || '');
                    if (ln !== null) return ln;
                    cmp = compareText(a.LastName, b.LastName, locale);
                    if (cmp === 0) cmp = compareText(a.FirstName, b.FirstName, locale);
                    break;
                }
                case 'birth': {
                    const bl = blankLast(a.BirthDate || '', b.BirthDate || '');
                    if (bl !== null) return bl;
                    cmp = (a.BirthDate || '').localeCompare(b.BirthDate || '');
                    break;
                }
                case 'death': {
                    const dl = blankLast(a.DeathDate || '', b.DeathDate || '');
                    if (dl !== null) return dl;
                    cmp = (a.DeathDate || '').localeCompare(b.DeathDate || '');
                    break;
                }
                case 'place': {
                    const pl = blankLast(a.BirthPlace?.toLowerCase() || '', b.BirthPlace?.toLowerCase() || '');
                    if (pl !== null) return pl;
                    cmp = compareText(a.BirthPlace, b.BirthPlace, locale);
                    break;
                }
                case 'sources': {
                    cmp = (a.SourcedFacts ?? 0) - (b.SourcedFacts ?? 0);
                    break;
                }
                case 'updated': {
                    const ul = blankLast(a.UpdatedAt || '', b.UpdatedAt || '');
                    if (ul !== null) return ul;
                    cmp = (a.UpdatedAt || '').localeCompare(b.UpdatedAt || '');
                    break;
                }
            }
            return sortDirection === 'asc' ? cmp : -cmp;
        });

        return r;
    }, [people, locale, flag, flaggedRank, searchQuery, sortColumn, sortDirection, effectiveSex, hasParentsFilter, hasChildrenFilter, surnameFilter, hasPhotoFilter, livingFilter]);

    const availableSurnames = useMemo(() => {
        const set = new Map<string, number>();
        for (const p of people) {
            if (p.LastName) set.set(p.LastName, (set.get(p.LastName) ?? 0) + 1);
        }
        return Array.from(set.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }, [people]);

    function familyRole(p: PersonWithParentFamily): string {
        const isPartner = (p.PartnershipCount ?? 0) > 0;
        const isParent = (p.ChildrenCount ?? 0) > 0;
        const isChild = !!(p.FatherFirstName || p.MotherFirstName);
        if (isPartner && isParent) {
            return p.Sex === 'F' ? t('role_spouse_mother') : p.Sex === 'M' ? t('role_spouse_father') : t('role_spouse_parent');
        }
        if (isPartner) return t('role_spouse');
        if (isParent) return p.Sex === 'F' ? t('role_mother') : p.Sex === 'M' ? t('role_father') : t('role_parent');
        if (isChild) return t('role_child');
        return '—';
    }

    const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
    const currentPeople = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

    function handleSort(col: SortColumn) {
        if (sortColumn === col) setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortColumn(col); setSortDirection('asc'); }
    }

    function cycleSex() {
        if (availableSexes.length === 0) return;
        const idx = effectiveSex ? availableSexes.indexOf(effectiveSex) : -1;
        setSexFilter(idx + 1 >= availableSexes.length ? null : availableSexes[idx + 1]);
    }

    // Each ✕ gets its own accessible name so a screen reader can tell the
    // chips' dismiss controls apart.
    const clearLabel = (name: string) => tCommon('clear_filter_named', { name });

    const sexAddLabel = t('filter_add_sex');
    const sexLabel = effectiveSex === 'M' ? t('filter_sex_male')
        : effectiveSex === 'F' ? t('filter_sex_female')
        : effectiveSex === 'X' ? t('filter_sex_nonbinary')
        : effectiveSex === 'U' ? t('filter_sex_unrecorded')
        : sexAddLabel;
    const surnameAddLabel = t('filter_add_surname');
    const surnameLabel = surnameFilter ? t('filter_surname_active', { name: surnameFilter }) : surnameAddLabel;
    const anyFilter = flag !== null || effectiveSex !== null || surnameFilter !== null
        || hasParentsFilter !== 'off' || hasChildrenFilter !== 'off' || hasPhotoFilter !== 'off' || livingFilter !== 'off';
    const sortLabel = (() => {
        const colName = sortColumn === 'name' ? t('sort_col_name') : sortColumn === 'birth' ? t('sort_col_birth') : sortColumn === 'death' ? t('sort_col_death') : sortColumn === 'place' ? t('sort_col_place') : t('sort_col_updated');
        const arrow = sortDirection === 'asc' ? '↑' : '↓';
        return t('sort_label', { col: colName, arrow });
    })();

    // One reset for both the "clear all" chip and the empty state — they used to
    // clear different subsets, so the empty state could leave a filter applied.
    function clearFlag() {
        setFlag(null);
        // Drop ?filter= so a reload doesn't bring the suggestion's filter back.
        if (urlFlag) router.replace('/people', { scroll: false });
    }

    function clearAllFilters() {
        clearFlag();
        setSexFilter(null);
        setSurnameFilter(null);
        setHasParentsFilter('off');
        setHasChildrenFilter('off');
        setHasPhotoFilter('off');
        setLivingFilter('off');
    }

    const emptyState = people.length === 0 ? (
        <EmptyState
            variant="empty"
            title={t('no_people_yet')}
            message={t('hint_add_first')}
            action={canEdit ? (
                <>
                    <span className="md:hidden">
                        <CopperPill icon={<Plus aria-hidden="true" />} onClick={() => setAdding(true)}>{t('add_person')}</CopperPill>
                    </span>
                    <span className="hidden md:inline">
                        <Button variant="outline" size="sm" onClick={() => router.push('/people/new')}>{t('add_person_outline')}</Button>
                    </span>
                </>
            ) : undefined}
        />
    ) : (
        <EmptyState
            variant="filtered"
            title={t('no_matches')}
            message={t('hint_clear')}
            clearLabel={tCommon('clear_filters')}
            onClear={() => { clearAllFilters(); setSearchQuery(''); }}
        />
    );

    const peopleColumns: Column<PersonWithParentFamily>[] = [
        {
            key: 'name',
            header: t('col_name_label'),
            sortable: true,
            width: '60%',
            render: (person) => {
                const initials = getInitials(displayFirstName(person), person.LastName);
                const fullName = displayFullName(person) || t('unnamed');
                return (
                    <div className="row gap-2.5">
                        <PersonAvatar
                            mediaId={person.PrimaryMediaId}
                            treeId={activeTreeId}
                            name={String(fullName)}
                            initials={initials}
                            sex={person.Sex}
                            size={32}
                            focalX={person.FocalX}
                            focalY={person.FocalY}
                            focalRadius={person.FocalRadius}
                        />
                        <div>
                            <Link href={`/people/view?id=${person.Id}`} className="text-sm no-underline" style={{ color: 'var(--text)' }}>
                                <SplitName person={person} unnamed={String(fullName)} surnameFirst />
                            </Link>
                            {/* The parent line is always laid out, empty or not, so every
                                row has the same height (TB-2, #747). */}
                            <div className="muted text-xs mt-px" aria-hidden={!(person.FatherFirstName || person.MotherFirstName) || undefined}>
                                {[person.FatherFirstName && `${person.FatherFirstName} ${person.FatherLastName || ''}`.trim(), person.MotherFirstName && `${person.MotherFirstName} ${person.MotherLastName || ''}`.trim()].filter(Boolean).join(' & ') || '\u00a0'}
                            </div>
                        </div>
                    </div>
                );
            },
        },
        {
            key: 'birth',
            header: t('col_born'),
            sortable: true,
            className: 'whitespace-nowrap',
            render: (person) => <span className="date-mono date-muted text-sm">{formatDateForDisplay(person.BirthDate, language, dateWords) || <span className="muted">—</span>}</span>,
        },
        {
            key: 'death',
            header: t('col_died'),
            sortable: true,
            className: 'whitespace-nowrap',
            render: (person) => <span className="date-mono date-muted text-sm">{formatDateForDisplay(person.DeathDate, language, dateWords) || <span className="muted">—</span>}</span>,
        },
        {
            key: 'place',
            header: t('col_birthplace'),
            sortable: true,
            // Birthplace and Family role hide below lg rather than squeeze the
            // name column to one word per line (#806, T-2).
            headerClassName: 'hidden lg:table-cell',
            className: 'hidden lg:table-cell',
            render: (person) => (
                <span className="inline-block align-middle text-meta max-w-[200px] truncate" style={{ color: 'var(--text-2)' }}>
                    {person.BirthPlace || <span className="muted">—</span>}
                </span>
            ),
        },
        {
            key: 'family_role',
            header: t('col_family_role'),
            headerClassName: 'hidden lg:table-cell',
            className: 'muted hidden lg:table-cell',
            render: (person) => <span className="text-meta whitespace-nowrap">{familyRole(person)}</span>,
        },
        {
            key: 'sources',
            header: t('col_sources'),
            align: 'right',
            sortable: true,
            render: (person) => {
                const total = person.TotalFacts ?? 0;
                const sourced = person.SourcedFacts ?? 0;
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
        <PageShell
            topBar={<MobileListHeader title={t('title')} />}
            title={t('title')}
            // Below md the dark header names the page and the list runs edge to edge (#1063).
            titleClassName="max-md:hidden"
            contentClassName="max-md:p-0!"
            subtitle={phase === 'ready'
                ? t('people_count', { count: people.length })
                // PageShell wraps `subtitle` in a <p>; a block-level Skeleton div isn't
                // valid phrasing content there, so use an inline span for this slot.
                : <span className="skeleton inline-block h-4 w-40 rounded-[6px]" aria-hidden="true" />}
            // One create path per screen (FL-2): the FAB takes over below md.
            actions={canEdit && (
                <div className="hidden md:block">
                    <Button variant="primary" size="md" icon={<Plus className="w-4 h-4" aria-hidden="true" />} onClick={() => router.push('/people/new')}>{t('add_person')}</Button>
                </div>
            )}
        >

                {/* Phone: the filter field and chips, sliding away on scroll down */}
                <MobilePeopleFilters
                    query={searchQuery}
                    onQuery={setSearchQuery}
                    duplicates={flag !== null}
                    onClearDuplicates={clearFlag}
                    surname={surnameFilter}
                    onSurname={setSurnameFilter}
                    surnames={availableSurnames}
                    sexLabel={effectiveSex !== null ? sexLabel : null}
                    sexAvailable={phase !== 'ready' || availableSexes.length >= 2}
                    onCycleSex={cycleSex}
                    onClearSex={() => setSexFilter(null)}
                    tri={[
                        { state: hasParentsFilter, onChange: setHasParentsFilter, yes: t('filter_has_parents'), no: t('filter_no_parents') },
                        { state: hasChildrenFilter, onChange: setHasChildrenFilter, yes: t('filter_has_children'), no: t('filter_no_children') },
                        { state: hasPhotoFilter, onChange: setHasPhotoFilter, yes: t('filter_has_photo'), no: t('filter_no_photo') },
                        { state: livingFilter, onChange: setLivingFilter, yes: t('filter_living'), no: t('filter_deceased'), off: t('filter_living_any') },
                    ]}
                    anyFilter={anyFilter}
                    onClearAll={clearAllFilters}
                />

                {/* Desktop: search + filter chips */}
                <div className="hidden md:block">
                    {/* Search row */}
                    <SearchBar
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder={t('search_placeholder_full')}
                        clearLabel={t('clear_search')}
                        trailing={!loading ? (
                            <span className="muted text-meta shrink-0">
                                {filtered.length !== people.length ? t('count_of', { filtered: filtered.length, total: people.length }) : t('count_total', { total: people.length })}
                            </span>
                        ) : undefined}
                    />

                    {/* Filter chips row */}
                    <div className="list-filter-chips mb-1">
                        {flag && (
                            <FilterChip
                                label={t('filter_duplicates')}
                                active
                                dismissible
                                dismissLabel={clearLabel(t('filter_duplicates'))}
                                onClick={clearFlag}
                                onDismiss={clearFlag}
                            />
                        )}
                        <div ref={surnameChipRef} className="inline-flex shrink-0">
                            <FilterChip
                                label={surnameFilter !== null ? surnameLabel : surnameAddLabel}
                                icon={surnameFilter !== null ? undefined : <Plus className="w-3.5 h-3.5" aria-hidden="true" />}
                                active={surnameFilter !== null}
                                dismissible
                                dismissLabel={clearLabel(surnameLabel)}
                                onClick={toggleSurnamePicker}
                                onDismiss={() => setSurnameFilter(null)}
                            />
                        </div>
                        {/* A one-option filter filters nothing, so the sex chip only
                            appears when the loaded tree has at least two buckets. It is
                            held during loading so the row does not shift when data lands
                            (the cycle is a no-op until there are buckets to cycle). */}
                        {(phase !== 'ready' || availableSexes.length >= 2) && (
                            <FilterChip
                                label={effectiveSex !== null ? sexLabel : sexAddLabel}
                                icon={effectiveSex !== null ? undefined : <Plus className="w-3.5 h-3.5" aria-hidden="true" />}
                                active={effectiveSex !== null}
                                dismissible
                                dismissLabel={clearLabel(sexLabel)}
                                onClick={cycleSex}
                                onDismiss={() => setSexFilter(null)}
                            />
                        )}
                        <TriFilterChip
                            state={hasParentsFilter}
                            onChange={setHasParentsFilter}
                            clearLabel={clearLabel}
                            labels={{ off: t('filter_has_parents'), yes: t('filter_has_parents'), no: t('filter_no_parents') }}
                        />
                        <TriFilterChip
                            state={hasChildrenFilter}
                            onChange={setHasChildrenFilter}
                            clearLabel={clearLabel}
                            labels={{ off: t('filter_has_children'), yes: t('filter_has_children'), no: t('filter_no_children') }}
                        />
                        <TriFilterChip
                            state={hasPhotoFilter}
                            onChange={setHasPhotoFilter}
                            clearLabel={clearLabel}
                            labels={{ off: t('filter_has_photo'), yes: t('filter_has_photo'), no: t('filter_no_photo') }}
                        />
                        <TriFilterChip
                            state={livingFilter}
                            onChange={setLivingFilter}
                            clearLabel={clearLabel}
                            labels={{ off: t('filter_living_any'), yes: t('filter_living'), no: t('filter_deceased') }}
                        />
                        {anyFilter && (
                            <button
                                type="button"
                                onClick={clearAllFilters}
                                className="muted text-meta py-0 px-1 shrink-0"
                                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                                {t('clear_all')}
                            </button>
                        )}
                        <div className="hidden md:block flex-1" />
                        <span className="muted hidden md:inline text-meta shrink-0">{sortLabel}</span>
                    </div>

                    {/* Surname picker — fixed-positioned so it escapes the chip scroller's overflow clip */}
                    {showSurnamePicker && !surnameFilter && surnamePickerPos && (
                        <>
                            <div
                                onClick={() => setShowSurnamePicker(false)}
                                className="inset-0 z-[49]"
                                style={{ position: 'fixed' }}
                                aria-hidden="true"
                            />
                            <div
                                className="border border-[color:var(--border)] rounded-[8px] shadow-[0_4px_16px_rgba(0,0,0,0.12)] z-50 min-w-[200px] max-h-[280px] p-1"
                                style={{
                                    position: 'fixed',
                                    top: surnamePickerPos.top,
                                    left: surnamePickerPos.left,
                                    background: 'var(--card)',
                                    overflowY: 'auto',
                                }}
                            >
                                {availableSurnames.length === 0 ? (
                                    <div className="muted py-2 px-3 text-meta">{t('no_surnames')}</div>
                                ) : (
                                    availableSurnames.slice(0, 30).map(([name, count]) => (
                                        <button
                                            key={name}
                                            type="button"
                                            onClick={() => { setSurnameFilter(name); setShowSurnamePicker(false); }}
                                            className="row gap-1.5 justify-between py-1.5 px-2.5 text-sm text-left rounded-[4px]"
                                            style={{
                                                width: '100%',
                                                background: 'transparent',
                                                border: 'none',
                                                cursor: 'pointer',
                                                fontFamily: 'inherit',
                                                color: 'inherit',
                                            }}
                                        >
                                            <span>{name}</span>
                                            <span className="muted text-xs">{count}</span>
                                        </button>
                                    ))
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Loading skeleton */}
                {phase === 'loading' && (
                    <>
                        <div className="md:hidden"><SkeletonList rows={8} /></div>
                        <div className="hidden md:block card overflow-hidden mt-1.5">
                            <SkeletonList rows={8} />
                        </div>
                    </>
                )}

                {phase === 'ready' && listError != null && (
                    <InlineDataError
                        className="mt-1.5 max-md:mx-4 max-md:mt-3"
                        message={String(tCommon(errorToastKey(listError)))}
                        retryLabel={String(tCommon('retry'))}
                        onRetry={error != null ? retry : flagged.retry}
                    />
                )}

                {/* Empty state */}
                {phase === 'ready' && listError == null && filtered.length === 0 && (
                    <div className="mt-1.5 max-md:px-4">{emptyState}</div>
                )}

                {/* Content: mobile cards + desktop table */}
                {phase === 'ready' && filtered.length > 0 && (
                    <>
                        <MobilePeopleRows
                            rows={currentPeople}
                            count={filtered.length !== people.length
                                ? t('count_of', { filtered: filtered.length, total: people.length })
                                : t('count_total', { total: people.length })}
                            treeId={activeTreeId}
                            column={sortColumn}
                            ascending={sortDirection === 'asc'}
                            onSort={(col, asc) => { setSortColumn(col); setSortDirection(asc ? 'asc' : 'desc'); }}
                            duplicates={flag === 'duplicates'}
                            duplicateGroup={duplicateGroup}
                            page={currentPage}
                            pages={totalPages}
                            onPage={(n) => { setCurrentPage(n); window.scrollTo({ top: 0 }); }}
                        />

                        {/* Desktop table — hidden on mobile */}
                        <div className="hidden md:block mt-1.5">
                            <div className="card overflow-hidden">
                                <div className="overflow-x-auto">
                                    <DataTable
                                        columns={peopleColumns}
                                        rows={currentPeople}
                                        rowKey={(p) => p.Id}
                                        sort={{ key: sortColumn, dir: sortDirection }}
                                        onSortChange={(key) => handleSort(key as SortColumn)}
                                        onRowPrefetch={(p) => prefetchPerson(p.Id, activeTreeId)}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="hidden md:block">
                        <Pagination
                            current={currentPage}
                            total={totalPages}
                            onPrev={() => setCurrentPage(p => Math.max(1, p - 1))}
                            onNext={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            prevLabel={t('prev')}
                            nextLabel={t('next')}
                            positionLabel={t('page_pos', { current: currentPage, total: totalPages })}
                        />
                        </div>
                    </>
                )}

            {/* The phone's one copper pill, floating, sliding away on scroll down. The
                spacer lets the last rows scroll clear of it. An empty tree offers it in
                the empty state instead. */}
            {canEdit && people.length > 0 && (
                <>
                    <div className="h-24 md:hidden" aria-hidden="true" />
                    <CopperPill floating icon={<Plus aria-hidden="true" />} onClick={() => setAdding(true)}>{t('add_person')}</CopperPill>
                </>
            )}
            {canEdit && <AddPersonSheet open={adding} onClose={() => setAdding(false)} treeId={activeTreeId} />}
        </PageShell>
    );
}
