'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button, Card, CoverBand, IconButton, InlineDataError, PageShell, cx } from '@/app/components/ui';
import PersonAvatar from '@/app/components/PersonAvatar';
import { ArrowLeftRight, Search, X } from '@/lib/icons';
import { formatLifespan, formatYearOrEmpty } from '@/lib/date-utils';
import { getInitials } from '@/lib/utils/initials';
import { getDataClient } from '@/lib/data';
import { useTree } from '@/app/contexts/TreeContext';
import { errorToastKey } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import { displayFullName } from '@/lib/utils/names';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { MobileRelationship } from './MobileRelationship';

interface Person {
    Id: number;
    FirstName: string | null;
    LastName: string | null;
    // Present at runtime (people.list resolves the primary variant); typed
    // optional so displayFullName renders the effective name.
    EffectiveFirstName?: string | null;
    Nickname?: string | null;
    // Drawn by the phone page's rows (#1122).
    Sex?: string | null;
    BirthDate?: string | null;
    DeathDate?: string | null;
    PrimaryMediaId?: number;
    FocalX?: number;
    FocalY?: number;
    FocalRadius?: number | null;
}

interface RelationshipResult {
    path: Array<{
        id: number;
        name: string;
        relationship: string;
    }>;
    relationship: string;
    degree: number;
}

export default function RelationshipPage() {
    const t = useTranslations('relationship');
    const tCommon = useTranslations('common');
    const tPeople = useTranslations('people');
    const tNav = useTranslations('nav');
    useDocumentTitle(t('title'));
    const [people, setPeople] = useState<Person[]>([]);
    const [peopleTreeKey, setPeopleTreeKey] = useState<string | null>(null);
    const [person1, setPerson1] = useState<number | null>(null);
    const [person2, setPerson2] = useState<number | null>(null);
    const [search1, setSearch1] = useState('');
    const [search2, setSearch2] = useState('');
    const [result, setResult] = useState<RelationshipResult | null>(null);
    const [resultTreeKey, setResultTreeKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingPeople, setLoadingPeople] = useState(true);
    const [peopleError, setPeopleError] = useState<string | null>(null);
    const [peopleErrorTreeKey, setPeopleErrorTreeKey] = useState<string | null>(null);
    const [resultError, setResultError] = useState<string | null>(null);
    const [resultErrorTreeKey, setResultErrorTreeKey] = useState<string | null>(null);
    // Scope both the people picker and the relationship walk to the active
    // tree — with no treeId the API resolves the default tree, so a user who
    // switched trees would silently compute against the wrong data.
    const { activeTreeId } = useTree();
    const treeKey = activeTreeId == null ? 'default' : String(activeTreeId);
    const { redirectIfUnauthorized } = useErrorToast();
    const isMobile = useIsMobile();

    const peopleRequestRef = useRef(0);
    const relationshipRequestRef = useRef(0);
    const loadPeople = useCallback(async () => {
        const requestId = ++peopleRequestRef.current;
        setLoadingPeople(true);
        setPeopleError(null);
        setPeopleErrorTreeKey(null);
        try {
            const client = await getDataClient();
            const { people } = await client.people.list({ treeId: activeTreeId });
            if (peopleRequestRef.current !== requestId) return;
            setPeople(people);
            setPeopleTreeKey(treeKey);
        } catch (e) {
            if (peopleRequestRef.current !== requestId) return;
            if (redirectIfUnauthorized(e)) return;
            console.error('Failed to load people:', e);
            setPeopleError(tCommon(errorToastKey(e)));
            setPeopleErrorTreeKey(treeKey);
        } finally {
            if (peopleRequestRef.current === requestId) setLoadingPeople(false);
        }
    }, [activeTreeId, redirectIfUnauthorized, tCommon, treeKey]);

    useEffect(() => {
        // Tree switched: previously selected ids belong to the old tree, and
        // the old tree's people must not stay searchable while the new list
        // loads (a stale pick would query an id the new tree doesn't have).
        setPerson1(null);
        setPerson2(null);
        setResult(null);
        setResultTreeKey(null);
        setPeopleError(null);
        setPeopleErrorTreeKey(null);
        setResultError(null);
        setResultErrorTreeKey(null);
        setPeople([]);
        setPeopleTreeKey(null);
        relationshipRequestRef.current += 1;
        void loadPeople();
    }, [activeTreeId, loadPeople]);

    const getFullName = (person: Person) => {
        return displayFullName(person) || tCommon('unknown');
    };

    const currentPeople = peopleTreeKey === treeKey ? people : [];
    const currentResult = resultTreeKey === treeKey ? result : null;
    const currentPeopleError = peopleErrorTreeKey === treeKey ? peopleError : null;
    const currentResultError = resultErrorTreeKey === treeKey ? resultError : null;

    const filteredPeople1 = currentPeople.filter(p => {
        const words = search1.toLowerCase().trim().split(/\s+/);
        const name = getFullName(p).toLowerCase();
        return words.every(w => name.includes(w));
    }).slice(0, 10);

    const filteredPeople2 = currentPeople.filter(p => {
        const words = search2.toLowerCase().trim().split(/\s+/);
        const name = getFullName(p).toLowerCase();
        return words.every(w => name.includes(w));
    }).slice(0, 10);

    async function calculateRelationship() {
        if (!person1 || !person2) return;
        const requestId = ++relationshipRequestRef.current;
        setLoading(true);
        setResult(null);
        setResultTreeKey(null);
        setResultError(null);
        setResultErrorTreeKey(null);

        try {
            const client = await getDataClient();
            const data = await client.relationship.get(person1, person2, activeTreeId);
            if (relationshipRequestRef.current !== requestId) return;
            setResult(data);
            setResultTreeKey(treeKey);
            setResultError(null);
        } catch (e) {
            if (relationshipRequestRef.current !== requestId) return;
            if (redirectIfUnauthorized(e)) return;
            console.error('Failed to calculate:', e);
            setResultError(tCommon(errorToastKey(e)));
            setResultErrorTreeKey(treeKey);
        } finally {
            if (relationshipRequestRef.current === requestId) setLoading(false);
        }
    }

    const selectedPerson1 = currentPeople.find(p => p.Id === person1);
    const selectedPerson2 = currentPeople.find(p => p.Id === person2);

    if (isMobile) {
        return (
            <MobileRelationship
                treeId={activeTreeId}
                people={currentPeople}
                person1={person1}
                person2={person2}
                // Picking someone new clears the old answer, as on desktop.
                onPick={(slot, id) => { if (slot === 1) setPerson1(id); else setPerson2(id); setResult(null); }}
                onSwap={() => { setPerson1(person2); setPerson2(person1); setResult(null); }}
                onFind={calculateRelationship}
                loading={loading}
                result={currentResult}
                resultError={currentResultError}
                peopleError={currentPeopleError}
                onRetryPeople={loadPeople}
            />
        );
    }

    // The person where the path turns from going up to going down: the shared ancestor.
    const path = currentResult?.path ?? [];
    const peak = path.findIndex((step, i) => i > 0 && i < path.length - 1 && step.relationship === 'child' && path[i + 1].relationship === 'parent');
    const ancestor = peak > 0 ? path[peak] : null;
    const link = (rel: string) => (rel === 'child' ? t('path_child_of') : rel === 'parent' ? t('path_parent_of') : rel === 'spouse' ? t('path_partner_of') : rel);

    return (
        <PageShell>
            {/* The Tools pages' short band (#59). */}
            <div className="mb-4">
                <CoverBand variant="short" eyebrow={tNav('tools')} title={t('title')} meta={t('subtitle')} />
            </div>
            <div className="grid gap-5">
                {/* One row: the two people, Swap between them, then Find relationship (locked list-pages board). */}
                <Card pad={false} className="p-4">
                    {currentPeopleError && (
                        <InlineDataError className="mb-4" message={currentPeopleError} retryLabel={tCommon('retry')} onRetry={loadPeople} />
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-3">
                        <PersonSlot
                            label={t('first_person')}
                            selected={selectedPerson1}
                            search={search1}
                            onSearch={setSearch1}
                            matches={filteredPeople1}
                            onPick={(id) => { setPerson1(id); setSearch1(''); }}
                            onClear={() => { setPerson1(null); setSearch1(''); }}
                            getFullName={getFullName}
                            treeId={activeTreeId}
                        />
                        <IconButton
                            label={t('swap_title')}
                            title={t('swap_title')}
                            onClick={() => {
                                const [p1, p2] = [person1, person2];
                                setPerson1(p2); setPerson2(p1);
                                const [s1, s2] = [search1, search2];
                                setSearch1(s2); setSearch2(s1);
                                setResult(null);
                            }}
                            disabled={!person1 && !person2}
                            icon={<ArrowLeftRight className="w-4 h-4" />}
                            className="w-9 h-9 inline-flex items-center justify-center rounded-[8px] border border-border bg-card justify-self-center"
                        />
                        <PersonSlot
                            label={t('second_person')}
                            selected={selectedPerson2}
                            search={search2}
                            onSearch={setSearch2}
                            matches={filteredPeople2}
                            onPick={(id) => { setPerson2(id); setSearch2(''); }}
                            onClear={() => { setPerson2(null); setSearch2(''); }}
                            getFullName={getFullName}
                            treeId={activeTreeId}
                        />
                        <Button variant="primary" onClick={calculateRelationship} disabled={!person1 || !person2 || loading}>
                            {loading ? t('calculating') : t('find_relationship')}
                        </Button>
                    </div>
                </Card>

                {currentResultError && (
                    <InlineDataError message={currentResultError} retryLabel={tCommon('retry')} onRetry={calculateRelationship} />
                )}

                {currentResult && (
                    <Card pad={false} className="p-5">
                        <p className="eyebrow m-0">{t('result')}</p>
                        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 mt-1 mb-[18px]">
                            <h2 role="status" className="m-0 serif text-2xl font-semibold leading-tight text-text">{currentResult.relationship}</h2>
                            {currentResult.degree > 0 && <span className="font-mono text-meta text-text-muted">{t('steps_apart', { count: currentResult.degree })}</span>}
                        </div>

                        {/* The path, left to right: each person over who they are on it, joined by
                            "child of" / "parent of" on a hairline; both ends stand out. */}
                        {path.length > 0 && (
                            <ol aria-label={t('path_heading')} className="list-none m-0 p-0 pb-1 flex items-stretch overflow-x-auto">
                                {path.map((step, idx) => {
                                    const end = idx === 0 || idx === path.length - 1;
                                    const who = currentPeople.find((p) => p.Id === step.id);
                                    const sub = idx === 0 ? t('node_first')
                                        : idx === path.length - 1 ? t('node_second')
                                        : idx === peak ? t('node_shared_ancestor')
                                        : formatLifespan({ birth: formatYearOrEmpty(who?.BirthDate), death: formatYearOrEmpty(who?.DeathDate) });
                                    return (
                                        <li key={step.id} className="flex items-stretch">
                                            {idx > 0 && (
                                                <span aria-hidden="true" className="grid content-center justify-items-center gap-1 min-w-16 text-xs text-text-muted">
                                                    {link(step.relationship)}
                                                    <i className="block w-full h-px bg-border" />
                                                </span>
                                            )}
                                            {idx > 0 && <span className="sr-only">{link(step.relationship)}</span>}
                                            <Link href={`/people/view?id=${step.id}`}
                                                className={cx('grid justify-items-center content-start gap-1.5 text-center min-w-[132px] px-2 py-3 rounded-[10px] no-underline focus-ring hover:bg-hover-surface',
                                                    end && 'bg-card-alt shadow-[inset_0_0_0_1px_var(--color-border)]')}>
                                                <PersonAvatar as="span" size={32} treeId={activeTreeId} name={step.name} sex={who?.Sex ?? null}
                                                    mediaId={who?.PrimaryMediaId} focalX={who?.FocalX} focalY={who?.FocalY} focalRadius={who?.FocalRadius}
                                                    initials={who ? getInitials(who.FirstName, who.LastName) : undefined} />
                                                <span className="serif text-base font-semibold leading-tight text-text">{step.name}</span>
                                                {sub && <span className="text-xs text-text-muted">{sub}</span>}
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}

                        {ancestor && (
                            <p className="m-0 mt-3.5 flex flex-wrap items-baseline gap-x-1.5 text-sm text-text-secondary">
                                <span>{t('shared_ancestor', { name: ancestor.name })}</span>
                                <Link href={`/tree?rootId=${ancestor.id}`} className="text-link underline">{t('show_in_tree')}</Link>
                            </p>
                        )}
                    </Card>
                )}

                {loadingPeople && <div className="text-center text-text-muted py-8">{tPeople('loading')}</div>}
            </div>
        </PageShell>
    );
}

/**
 * One side of the calculator, a picker box: the chosen person (avatar, the
 * small uppercase label, the serif name and years, ×), or the label over a
 * search field with its matches below.
 */
function PersonSlot({ label, selected, search, onSearch, matches, onPick, onClear, getFullName, treeId }: {
    label: string;
    selected: Person | undefined;
    search: string;
    onSearch: (value: string) => void;
    matches: Person[];
    onPick: (id: number) => void;
    onClear: () => void;
    getFullName: (person: Person) => string;
    treeId: number | null;
}) {
    const t = useTranslations('relationship');
    const tCommon = useTranslations('common');
    const inputId = useId();
    const box = 'flex items-center gap-3 min-h-[62px] px-3.5 py-2.5 rounded-[10px] border border-border bg-card min-w-0';
    if (selected) {
        const name = getFullName(selected);
        const years = formatLifespan({ birth: formatYearOrEmpty(selected.BirthDate), death: formatYearOrEmpty(selected.DeathDate) });
        return (
            <div className={box}>
                <PersonAvatar as="span" size={32} treeId={treeId} name={name} sex={selected.Sex ?? null}
                    mediaId={selected.PrimaryMediaId} focalX={selected.FocalX} focalY={selected.FocalY} focalRadius={selected.FocalRadius}
                    initials={getInitials(selected.FirstName, selected.LastName)} />
                <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold uppercase tracking-[0.07em] text-text-muted">{label}</span>
                    <span className="block truncate">
                        <span className="serif text-md font-semibold text-text">{name}</span>
                        {years && <span className="date-mono text-meta ml-1.5">{years}</span>}
                    </span>
                </span>
                <IconButton size="sm" label={t('clear_person', { name })} icon={<X className="w-4 h-4" />} onClick={onClear} />
            </div>
        );
    }
    return (
        <div className="relative min-w-0">
            <div className={cx(box, 'focus-ring-within')}>
                <Search className="w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />
                <span className="flex-1 min-w-0">
                    <label htmlFor={inputId} className="block text-xs font-semibold uppercase tracking-[0.07em] text-text-muted">{label}</label>
                    <input id={inputId} type="search" value={search} onChange={(e) => onSearch(e.target.value)}
                        placeholder={tCommon('search_for_person')} autoComplete="off"
                        className="input-nozoom w-full bg-transparent border-0 p-0 text-base text-text placeholder:text-text-muted focus:outline-none" />
                </span>
            </div>
            {search && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {matches.map(p => (
                        <button type="button" key={p.Id} onClick={() => onPick(p.Id)}
                            className="w-full px-3 py-2 text-left text-text hover:bg-hover-surface cursor-pointer focus-ring-inset">
                            {getFullName(p)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
