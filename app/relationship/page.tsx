'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button, Card, IconButton, InlineDataError, Input, PageShell } from '@/app/components/ui';
import { ArrowDown, ArrowLeftRight, Link2Off, LinkIcon, Search, UserRound, X } from '@/lib/icons';
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

    return (
        <PageShell title={t('title')} subtitle={t('subtitle')}>
                <div className="max-w-2xl">
                    {/* Person Selection */}
                    <Card pad={false} className="p-6 mb-6">
                        {currentPeopleError && (
                            <InlineDataError
                                className="mb-4"
                                message={currentPeopleError}
                                retryLabel={tCommon('retry')}
                                onRetry={loadPeople}
                            />
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                            <PersonSlot
                                label={t('first_person')}
                                selected={selectedPerson1}
                                search={search1}
                                onSearch={setSearch1}
                                matches={filteredPeople1}
                                onPick={(id) => { setPerson1(id); setSearch1(''); }}
                                onClear={() => { setPerson1(null); setSearch1(''); }}
                                getFullName={getFullName}
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
                            />
                        </div>

                        <div className="mt-4 flex justify-center">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    const [p1, p2] = [person1, person2];
                                    setPerson1(p2); setPerson2(p1);
                                    const [s1, s2] = [search1, search2];
                                    setSearch1(s2); setSearch2(s1);
                                    setResult(null);
                                }}
                                disabled={!person1 && !person2}
                                icon={<ArrowLeftRight className="w-4 h-4" aria-hidden="true" />}
                                title={t('swap_title')}
                            >
                                {t('swap')}
                            </Button>
                        </div>

                        <Button
                            variant="primary"
                            onClick={calculateRelationship}
                            disabled={!person1 || !person2 || loading}
                            className="mt-4"
                        >
                            {loading ? t('calculating') : t('find_relationship')}
                        </Button>
                    </Card>

                    {/* Result */}
                    {currentResultError && (
                        <InlineDataError
                            className="mb-6"
                            message={currentResultError}
                            retryLabel={tCommon('retry')}
                            onRetry={calculateRelationship}
                        />
                    )}

                    {currentResult && (
                        <Card pad={false} className="p-6">
                            <div className="text-center mb-6">
                                <ResultIcon degree={currentResult.degree} />
                                <h2 className="title text-text mb-2">
                                    {currentResult.relationship}
                                </h2>
                                {currentResult.degree > 0 && (
                                    <p className="text-text-muted">
                                        {t('steps_apart', { count: currentResult.degree })}
                                    </p>
                                )}
                            </div>

                            {/* Relationship Path */}
                            {currentResult.path.length > 0 && (
                                <div>
                                    <h3 className="eyebrow mb-3">
                                        {t('path_heading')}
                                    </h3>
                                    <div className="space-y-2">
                                        {currentResult.path.map((step, idx) => (
                                            <div key={step.id} className="flex items-center gap-3">
                                                {idx > 0 && (
                                                    <div className="w-8 flex flex-col items-center text-text-muted">
                                                        <ArrowDown className="w-4 h-4" aria-hidden="true" />
                                                        <span className="text-xs">{step.relationship}</span>
                                                    </div>
                                                )}
                                                {idx === 0 && <div className="w-8" />}
                                                <Link
                                                    href={`/people/view?id=${step.id}`}
                                                    className="flex-1 flex items-center gap-3 p-3 bg-surface rounded-lg hover:bg-hover-surface transition-colors"
                                                >
                                                    <UserRound className="w-5 h-5 text-text-muted shrink-0" aria-hidden="true" />
                                                    <span className="font-medium text-text">{step.name}</span>
                                                </Link>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </Card>
                    )}

                    {loadingPeople && (
                        <div className="text-center text-text-muted py-8">
                            {tPeople('loading')}
                        </div>
                    )}
                </div>
        </PageShell>
    );
}

/** The degree's glyph: 0 is the same person, -1 is no path found, otherwise a link. */
function ResultIcon({ degree }: { degree: number }) {
    const Icon = degree === 0 ? UserRound : degree === -1 ? Link2Off : LinkIcon;
    return <Icon className="w-8 h-8 mx-auto mb-2 text-text-muted" aria-hidden="true" />;
}

/** One side of the calculator: the chosen person, or a search field with its matches. */
function PersonSlot({ label, selected, search, onSearch, matches, onPick, onClear, getFullName }: {
    label: string;
    selected: Person | undefined;
    search: string;
    onSearch: (value: string) => void;
    matches: Person[];
    onPick: (id: number) => void;
    onClear: () => void;
    getFullName: (person: Person) => string;
}) {
    const t = useTranslations('relationship');
    const tCommon = useTranslations('common');
    const inputId = useId();
    return (
        <div>
            <label htmlFor={selected ? undefined : inputId} className="block text-sm font-medium text-text-secondary mb-2">
                {label}
            </label>
            {selected ? (
                <div className="flex items-center gap-2 min-h-9 pl-3 pr-1 py-1 bg-surface-2 border border-border rounded-lg">
                    <UserRound className="w-4 h-4 text-text-muted shrink-0" aria-hidden="true" />
                    <span className="font-medium text-text truncate">{getFullName(selected)}</span>
                    <IconButton
                        className="ml-auto"
                        size="sm"
                        label={t('clear_person', { name: getFullName(selected) })}
                        icon={<X className="w-4 h-4" />}
                        onClick={onClear}
                    />
                </div>
            ) : (
                <div>
                    <Input
                        id={inputId}
                        type="search"
                        value={search}
                        onChange={(e) => onSearch(e.target.value)}
                        placeholder={tCommon('search_for_person')}
                        icon={<Search className="w-4 h-4" />}
                    />
                    {search && (
                        <div className="mt-1 bg-card border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                            {matches.map(p => (
                                <button
                                    type="button"
                                    key={p.Id}
                                    onClick={() => onPick(p.Id)}
                                    className="w-full px-3 py-2 text-left text-text hover:bg-hover-surface cursor-pointer focus-ring"
                                >
                                    {getFullName(p)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
