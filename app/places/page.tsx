'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useTree } from '@/app/contexts/TreeContext';
import { getDataClient } from '@/lib/data';
import { errorToastKey } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import Link from 'next/link';
import { Button, EmptyState, InlineDataError, MobileListHeader, PageShell } from '@/app/components/ui';
import { Input } from '@/app/components/ui/Input';
import { MapPin, Plus, Search, Upload } from '@/lib/icons';
import { PinLegend } from './PinLegend';
import { ExploreView } from './explore/ExploreView';
import { ExploreSkeleton } from './explore/ExploreSkeleton';
import { MobilePlacesExplore } from './explore/MobilePlacesExplore';
import { SkeletonList } from '@/app/components/SkeletonLoader';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { buildPlaceTree } from '@/lib/places/hierarchy';

import type { PlaceGazetteerNode, PlaceSummary } from '@/lib/data/types';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';

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
    // Explore portals its breadcrumb into the bar, beside the filter.
    const [crumbSlot, setCrumbSlot] = useState<HTMLDivElement | null>(null);
    // Explore is the only view (#56 dropped Cards and List): a full-page workspace on
    // desktop, the phone's own drill below md (#1118).
    const isPhone = useIsMobile();
    const requestIdRef = useRef(0);
    const { redirectIfUnauthorized } = useErrorToast();

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

    // Explore searches globally from inside the drill, so it gets the WHOLE tree —
    // pruning it here would make a match outside the current jurisdiction
    // unreachable without first navigating up. Cards/List keep the filtered set.
    const exploreTree = useMemo(() => buildPlaceTree(currentPlaces, currentGazetteer), [currentPlaces, currentGazetteer]);

    if (isPhone) {
        return (
            <PageShell topBar={<MobileListHeader title={t('title')} />} contentClassName="max-md:p-0!">
                {currentError && currentPlaces.length > 0 && (
                    <InlineDataError className="mb-6" message={currentError} retryLabel={tCommon('retry')} onRetry={fetchPlaces} />
                )}
                {phase === 'loading' ? <SkeletonList rows={8} />
                    : phase === 'pending' ? null
                    : currentError && currentPlaces.length === 0 ? <InlineDataError message={currentError} retryLabel={tCommon('retry')} onRetry={fetchPlaces} />
                    : currentPlaces.length === 0 ? <div className="px-4 pt-6"><EmptyState variant="empty" title={t('empty_title')} message={t('no_results_empty')} /></div>
                    : <MobilePlacesExplore roots={exploreTree} />}
            </PageShell>
        );
    }

    // Desktop (#56): a full-page workspace like the tree, with a slim Places bar (the filter
    // and the pin legend, left-aligned like the tree bar's find field, then the breadcrumb) over the three Explore panes.
    return (
        <PageShell variant="workspace" className="flex flex-col overflow-hidden" style={{ height: 'calc(100dvh - var(--nav-h))' }}>
            {/* The tree control bar's dark island, in both themes: the card tone sat
                flush with the dark-mode nav. */}
            <div className="dark-island shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 bg-[color:var(--color-hero-bg)]">
                <h1 className="sr-only">{t('title')}</h1>
                <div className="flex items-center gap-2">
                    <Input
                        type="search"
                        size="sm"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={t('search_placeholder')}
                        aria-label={t('search_placeholder')}
                        icon={<Search size={16} aria-hidden="true" />}
                        wrapClassName="w-64"
                    />
                    {/* The key to the geocode-state marks (#266). */}
                    <PinLegend className="shrink-0" />
                </div>
                {/* Empty (and so hidden, with its rule) until Explore has loaded. */}
                <div ref={setCrumbSlot} className="flex min-w-0 flex-1 items-center gap-4 empty:hidden before:h-6 before:w-px before:shrink-0 before:bg-[color:var(--color-border)] before:content-['']" />
            </div>
            {currentError && currentPlaces.length > 0 && (
                <InlineDataError className="m-3" message={currentError} retryLabel={tCommon('retry')} onRetry={fetchPlaces} />
            )}
            {phase === 'loading' ? (
                <ExploreSkeleton />
            ) : phase === 'pending' ? null : currentError && currentPlaces.length === 0 ? (
                <div className="p-6"><InlineDataError message={currentError} retryLabel={tCommon('retry')} onRetry={fetchPlaces} /></div>
            ) : currentPlaces.length === 0 ? (
                // No places at all: the whole page is one message over a faded map (#56).
                <div className="relative flex-1 flex items-center justify-center p-6" style={{ background: 'var(--map-well-bg)' }}>
                    <MapPin size={220} className="absolute text-text-muted opacity-10" aria-hidden="true" />
                    <div className="relative max-w-[420px] text-center">
                        <EmptyState variant="empty" title={t('empty_title')} message={t('empty_explore')} />
                        <div className="mt-3 flex flex-wrap justify-center gap-2">
                            <Link href="/import-export"><Button variant="outline" icon={<Upload className="w-4 h-4" aria-hidden="true" />}>{t('empty_import')}</Button></Link>
                            <Link href="/people?add=1"><Button variant="primary" icon={<Plus className="w-4 h-4" aria-hidden="true" />}>{t('empty_add_person')}</Button></Link>
                        </div>
                    </div>
                </div>
            ) : (
                <ExploreView roots={exploreTree} treeId={activeTreeId} search={search} onClearSearch={() => setSearch('')} breadcrumbSlot={crumbSlot} />
            )}
        </PageShell>
    );
}
