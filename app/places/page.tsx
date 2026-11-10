'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useTree } from '@/app/contexts/TreeContext';
import { getDataClient } from '@/lib/data';
import { errorToastKey } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import LocationMap, { type MapMarker } from '@/app/components/LocationMap';
import { EmptyState, InlineDataError, MobileListHeader, PageShell } from '@/app/components/ui';
import { Input } from '@/app/components/ui/Input';
import { Badge } from '@/app/components/ui/Badge';
import { MapPin, Search } from '@/lib/icons';
import { PlaceCard } from './PlaceCard';
import { PlaceGroupSection } from './PlaceGroupSection';
import { PlacesTable } from './PlacesTable';
import { ViewToggle } from './ViewToggle';
import type { PlacesViewMode } from '@/lib/places/view-mode';
import { PLACES_VIEW_MODE_KEY, readPlacesViewMode } from '@/lib/places/view-mode';
import { PinLegend } from './PinLegend';
import { ExploreView } from './explore/ExploreView';
import { ExploreSkeleton } from './explore/ExploreSkeleton';
import { MobilePlacesExplore } from './explore/MobilePlacesExplore';
import { SkeletonList } from '@/app/components/SkeletonLoader';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { groupByRoot, buildPlaceTree, placeNameMatches } from '@/lib/places/hierarchy';

import type { PlaceGazetteerNode, PlaceSummary } from '@/lib/data/types';
import { foldForSearch } from '@/lib/utils/search-fold';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { placeHref } from '@/lib/places/place-key';

export default function PlacesPage() {
    const t = useTranslations('places');
    const tCommon = useTranslations('common');
    const { activeTreeId, currentUserId } = useTree();
    const treeKey = activeTreeId == null ? 'default' : String(activeTreeId);
    const [places, setPlaces] = useState<PlaceSummary[]>([]);
    const [gazetteer, setGazetteer] = useState<PlaceGazetteerNode[]>([]);
    const [placesTreeKey, setPlacesTreeKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [errorTreeKey, setErrorTreeKey] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [savedViewMode, setViewMode] = useState<PlacesViewMode>('explore');
    // Explore is the only phone view (#1118); Cards and List stay on desktop.
    const isPhone = useIsMobile();
    const viewMode: PlacesViewMode = isPhone ? 'explore' : savedViewMode;
    const requestIdRef = useRef(0);
    const { redirectIfUnauthorized } = useErrorToast();

    // Read the persisted view-mode choice after mount (server render + first
    // client paint use the 'explore' default, so there is no hydration mismatch —
    // mirrors app/tree/useTreeDisplayPrefs.ts's pattern).
    useEffect(() => {
        setViewMode(readPlacesViewMode(localStorage));
    }, []);

    function handleViewModeChange(mode: PlacesViewMode) {
        setViewMode(mode);
        localStorage.setItem(PLACES_VIEW_MODE_KEY, mode);
    }

    const fetchPlaces = useCallback(async () => {
        if (currentUserId === null) return;
        const requestId = ++requestIdRef.current;
        const isCurrent = () => requestIdRef.current === requestId;
        setLoading(true);
        setError(null);
        setErrorTreeKey(null);
        try {
            const client = await getDataClient();
            if (!isCurrent()) return;
            const { places, gazetteer } = await client.places.list(activeTreeId);
            if (!isCurrent()) return;
            setPlaces(places);
            setGazetteer(gazetteer);
            setPlacesTreeKey(treeKey);
        } catch (e) {
            if (!isCurrent()) return;
            if (redirectIfUnauthorized(e)) return;
            console.error('Failed to fetch places:', e);
            const key = errorToastKey(e);
            setError(key === 'error_generic' ? t('load_error') : tCommon(key));
            setErrorTreeKey(treeKey);
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [activeTreeId, currentUserId, redirectIfUnauthorized, t, tCommon, treeKey]);

    useEffect(() => { fetchPlaces(); }, [fetchPlaces]);
    useDocumentTitle(t('title'));

    // delay: 0 — skeleton-first. With the default 200ms `pending` window this view
    // rendered nothing at all until after hydration, so a hard reload painted blank →
    // skeleton → data. Explore reserves real geometry, so shipping the skeleton in the
    // prerendered HTML is strictly better than a blank frame. Matches the dashboard,
    // People and Families, which already opt in.
    const currentPlaces = useMemo(() => placesTreeKey === treeKey ? places : [], [placesTreeKey, treeKey, places]);
    const currentGazetteer = useMemo(() => placesTreeKey === treeKey ? gazetteer : [], [placesTreeKey, treeKey, gazetteer]);
    const currentError = errorTreeKey === treeKey ? error : null;
    const phase = useLoadPhase(currentUserId === null || ((loading || (placesTreeKey !== treeKey && !currentError)) && currentPlaces.length === 0), { delay: 0 });

    const filtered = useMemo(() => currentPlaces.filter(p =>
        !search || placeNameMatches(p.name, p.otherNames, foldForSearch(search))
    ), [currentPlaces, search]);

    const grouped = useMemo(() => groupByRoot(filtered, currentGazetteer), [filtered, currentGazetteer]);
    // Explore searches globally from inside the drill, so it gets the WHOLE tree —
    // pruning it here would make a match outside the current jurisdiction
    // unreachable without first navigating up. Cards/List keep the filtered set.
    const exploreTree = useMemo(() => buildPlaceTree(currentPlaces, currentGazetteer), [currentPlaces, currentGazetteer]);

    const markers: MapMarker[] = currentPlaces
        .filter((p) => p.latitude != null && p.longitude != null)
        .map((p) => ({
            lat: p.latitude!,
            lng: p.longitude!,
            label: p.name,
            href: placeHref(p),
        }));

    return (
        <PageShell
            topBar={<MobileListHeader title={t('title')} />}
            title={t('title')}
            // Below md the dark header names the page and Explore runs edge to edge (#1118).
            titleClassName="max-md:hidden"
            contentClassName="max-md:p-0!"
            subtitle={phase === 'ready'
                ? t('locations_count', { count: currentPlaces.length })
                // PageShell wraps `subtitle` in a <p>; a block-level Skeleton div isn't
                // valid phrasing content there, so use an inline span for this slot.
                : <span className="skeleton inline-block mt-1 h-4 w-32 rounded-[6px]" aria-hidden="true" />}
            actions={
                // Below sm the search takes its own full-width row: beside the view
                // toggle it collapsed to "Se" at 390 (#807).
                <div className="max-md:hidden flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto">
                    <Input
                        type="search"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={t('search_placeholder')}
                        aria-label={t('search_placeholder')}
                        icon={<Search size={16} aria-hidden="true" />}
                        // Same --control-h the ViewToggle beside it uses, so the
                        // pair lines up instead of agreeing by coincidence.
                        className="control-h"
                        wrapClassName="basis-full sm:basis-auto flex-1 min-w-0 sm:flex-none sm:w-64"
                    />
                    <div className="shrink-0">
                        <ViewToggle value={savedViewMode} onChange={handleViewModeChange} />
                    </div>
                    {/* The key to the geocode-state marks (#266). Lives beside the
                        view toggle because every view it explains is reached from
                        there. */}
                    <PinLegend className="shrink-0" />
                </div>
            }
        >
                {currentError && currentPlaces.length > 0 && (
                    <InlineDataError
                        className="mb-6"
                        message={currentError}
                        retryLabel={tCommon('retry')}
                        onRetry={fetchPlaces}
                    />
                )}
                {/* map hero — Explore mode owns its own map, so suppress the standalone hero */}
                {viewMode !== 'explore' && markers.length > 0 && (
                    <div className="relative mb-6">
                        <span className="sr-only">{t('map_hero_label')}</span>
                        <LocationMap markers={markers} variant="full" height={320} />
                        <Badge
                            tone="neutral"
                            className="absolute top-2 right-2 shadow-card"
                            title={t('geocoded_badge', { geo: markers.length, total: currentPlaces.length })}
                        >
                            <MapPin size={12} aria-hidden="true" />
                            <span className="tabular-nums">{t('geocoded_badge', { geo: markers.length, total: currentPlaces.length })}</span>
                        </Badge>
                    </div>
                )}

                {phase === 'loading' ? (
                    // Explore reserves its real geometry (map, drill list, detail pane);
                    // the other views are a plain list and keep the text line.
                    isPhone
                        ? <SkeletonList rows={8} />
                        : viewMode === 'explore'
                        ? <ExploreSkeleton />
                        : <div className="text-center py-16 text-text-muted">{t('loading')}</div>
                ) : phase === 'pending' ? null : currentError && currentPlaces.length === 0 ? (
                    <InlineDataError
                        message={currentError}
                        retryLabel={tCommon('retry')}
                        onRetry={fetchPlaces}
                    />
                ) : currentPlaces.length === 0 ? (
                    // Explore says "no matches" inside its own rail, so only a genuinely
                    // empty tree gets the page-level state there.
                    <div className="max-md:px-4 max-md:pt-6"><EmptyState variant="empty" title={t('empty_title')} message={t('no_results_empty')} /></div>
                ) : (filtered.length === 0 && viewMode !== 'explore') ? (
                    <EmptyState
                        variant="filtered"
                        message={t('no_results')}
                        clearLabel={tCommon('clear_search')}
                        onClear={() => setSearch('')}
                    />
                ) : isPhone ? (
                    <MobilePlacesExplore roots={exploreTree} />
                ) : viewMode === 'explore' ? (
                    <ExploreView roots={exploreTree} treeId={activeTreeId} search={search} />
                ) : viewMode === 'cards' ? (
                    grouped.groups.length === 0 ? (
                        // No jurisdiction hierarchy to group by (e.g. ungeocoded / flat data):
                        // render a plain grid, not a lone "Other places" section — this keeps the
                        // default view identical to the pre-hierarchy grid until a hierarchy exists.
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ gridAutoRows: '1fr' }}>
                            {grouped.other.map((p) => (
                                <PlaceCard key={p.id ?? p.name} id={p.id} name={p.name} count={p.count} peopleCount={p.peopleCount} faces={p.faces} />
                            ))}
                        </div>
                    ) : (
                        <>
                            {grouped.groups.map((g) => (
                                <PlaceGroupSection
                                    key={g.root.id ?? g.root.name}
                                    title={g.root.name.split(',')[0]?.trim() ?? g.root.name}
                                    titleHref={g.root.id != null ? placeHref(g.root) : undefined}
                                    rolledCount={g.rolledCount}
                                    places={g.places}
                                />
                            ))}
                            {grouped.other.length > 0 && (
                                <PlaceGroupSection
                                    title={t('other_places')}
                                    rolledCount={grouped.other.reduce((s, p) => s + p.count, 0)}
                                    places={grouped.other}
                                />
                            )}
                        </>
                    )
                ) : (
                    <PlacesTable places={filtered} />
                )}
        </PageShell>
    );
}
