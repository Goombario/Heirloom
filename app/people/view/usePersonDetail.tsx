'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { PersonWithRelations, PersonGalleryMedia } from '@/lib/db/schema';
import type { Citation } from '@/lib/db/queries/citations';
import { isFactTableValue, type FactTableValue } from '@/lib/db/fact-tables';
import type { CitationPreviewTarget } from '@/app/components/citations/types';
import { chipCitations, type SourceNumbers } from '@/app/components/citations/factDescriptors';
import Cite from '@/app/components/Cite';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import { useTree } from '@/app/contexts/TreeContext';
import { getDataClient } from '@/lib/data';
import { dataCache } from '@/lib/data/cache';
import { errorToastKey } from '@/lib/utils/data-error';
import { NotFoundError } from '@/lib/data/errors';
import { useErrorToast } from '@/app/components/useErrorToast';
import { scrollToTop } from '@/lib/scroll';
import { type NameVariant } from '@/app/components/person-form/NamesPanel';
import {
    personKey, mediaKey, citationsKey, variantsKey,
    loadPerson, loadPersonMedia, loadPersonCitations, loadPersonVariants,
    getPersonSummary,
} from './personCache';
import { fullName } from './derive';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { factPlaceKey, uniquePlaceKeys } from '@/lib/places/place-key';

export type CitationRow = Citation;
export type CitationMap = Record<string, Citation[]>;

export type AttachTarget = { factTable: FactTableValue; factId: number; factLabel: string; initialCitationId?: number; initialView?: 'attached' | 'add' | 'editor' | 'search' };

type ScopedResource<T> = { treeId: number | null; id: string; value: T };
type ScopedStatus = { treeId: number | null; id: string; loaded: boolean };

export function usePersonDetail() {
    const params = useSearchParams();
    const id = params.get('id') ?? '';
    const { activeTreeId, activePermission, currentUserId } = useTree();
    const t = useTranslations('personDetail');
    const tc = useTranslations('common');
    const { redirectIfUnauthorized } = useErrorToast();

    // Synchronously resolve the cached record for the current id on every render.
    // On a revisit (cross-route remount) or a related-person nav (same-route ?id
    // change) this lets the page paint the person immediately — no skeleton, and no
    // flash of the previously-viewed person. A cold load (cache miss) falls through
    // to the skeleton-first path below. Any write clears the whole cache
    // (withCacheInvalidation), so a post-edit revisit correctly misses and refetches.
    const personCacheKey = id ? personKey(activeTreeId, id) : null;
    const cachedPerson = personCacheKey ? dataCache.get<PersonWithRelations>(personCacheKey) ?? null : null;
    // Lightweight identity summary (from a previously-loaded list/tree). When the
    // full record isn't cached yet, the view paints the hero from this instead of a
    // blank while `people.get` resolves (#2).
    const summary = getPersonSummary(id, activeTreeId);

    const [person, setPerson] = useState<PersonWithRelations | null>(cachedPerson);
    const [personScope, setPersonScope] = useState<{ treeId: number | null; id: string } | null>(
        cachedPerson ? { treeId: activeTreeId, id } : null,
    );
    const [personError, setPersonError] = useState<string | null>(null);
    const [personErrorScope, setPersonErrorScope] = useState<{ treeId: number | null; id: string } | null>(null);
    // Seed media from cache too (like `person`), so a revisit with a cached photo
    // list paints the portrait on the first render instead of flashing the monogram
    // placeholder while `people.media` revalidates. The state carries the id it was
    // loaded for so a same-route ?id change never shows the previous person's photo
    // (see `media` derivation below — mirrors `activePerson`).
    const [mediaState, setMediaState] = useState<ScopedResource<PersonGalleryMedia[]>>(
        () => ({ treeId: activeTreeId, id, value: id ? dataCache.get<PersonGalleryMedia[]>(mediaKey(activeTreeId, id)) ?? [] : [] }),
    );
    const [mediaStatus, setMediaStatus] = useState<ScopedStatus>(() => ({
        treeId: activeTreeId,
        id,
        loaded: id ? dataCache.get<PersonGalleryMedia[]>(mediaKey(activeTreeId, id)) !== undefined : false,
    }));
    const [citationState, setCitationState] = useState<ScopedResource<CitationMap>>(() => ({
        treeId: activeTreeId,
        id,
        value: id ? dataCache.get<CitationMap>(citationsKey(activeTreeId, id)) ?? {} : {},
    }));
    const [citationStatus, setCitationStatus] = useState<ScopedStatus>(() => ({
        treeId: activeTreeId,
        id,
        loaded: id ? dataCache.get<CitationMap>(citationsKey(activeTreeId, id)) !== undefined : false,
    }));
    const [citationsError, setCitationsError] = useState<string | null>(null);
    const [citationsErrorScope, setCitationsErrorScope] = useState<{ treeId: number | null; id: string } | null>(null);
    const [variantsState, setVariantsState] = useState<ScopedResource<NameVariant[]>>(() => ({
        treeId: activeTreeId,
        id,
        value: id ? dataCache.get<NameVariant[]>(variantsKey(activeTreeId, id)) ?? [] : [],
    }));
    const [variantsStatus, setVariantsStatus] = useState<ScopedStatus>(() => ({
        treeId: activeTreeId,
        id,
        loaded: id ? dataCache.get<NameVariant[]>(variantsKey(activeTreeId, id)) !== undefined : false,
    }));
    const [variantsError, setVariantsError] = useState<string | null>(null);
    const [variantsErrorScope, setVariantsErrorScope] = useState<{ treeId: number | null; id: string } | null>(null);
    const [mediaError, setMediaError] = useState<string | null>(null);
    const [mediaErrorScope, setMediaErrorScope] = useState<{ treeId: number | null; id: string } | null>(null);
    const [loadedIdentity, setLoadedIdentity] = useState<{ treeId: number | null; id: string } | null>(
        cachedPerson ? { treeId: activeTreeId, id } : null,
    );
    const [showDescendants, setShowDescendants] = useState(false);
    const [attachTarget, setAttachTarget] = useState<AttachTarget | null>(null);
    const [citationPreview, setCitationPreview] = useState<CitationPreviewTarget | null>(null);
    const [showInlineEvent, setShowInlineEvent] = useState(false);
    const [showUpload, setShowUpload] = useState(false);
    const [placeCoordsState, setPlaceCoordsState] = useState<ScopedResource<Record<string, { lat: number; lng: number }>> | null>(null);
    const [showJourney, setShowJourney] = useState(false);
    const personRequest = useRef(0);
    const mediaRequest = useRef(0);
    const citationsRequest = useRef(0);
    const variantsRequest = useRef(0);
    // Prefer the state record for the current id; otherwise the freshly-cached one.
    // Keeps a same-route ?id change from momentarily showing the previous person.
    const activePerson = person && personScope?.treeId === activeTreeId && personScope.id === id
        ? person
        : cachedPerson;
    // Media for the current id. On a same-route ?id change the state still holds the
    // previous person's list until fetchMedia resolves; prefer the cached list for the
    // new id, else use an empty current-scope list. Cross-tree or cross-person media
    // must never remain actionable while the replacement read is pending.
    const media = mediaState.treeId === activeTreeId && mediaState.id === id
        ? mediaState.value
        : (id ? dataCache.get<PersonGalleryMedia[]>(mediaKey(activeTreeId, id)) ?? [] : []);
    const activeCitationMap = useMemo(
        () => citationState.treeId === activeTreeId && citationState.id === id ? citationState.value : {},
        [citationState, activeTreeId, id],
    );
    const activeVariants = useMemo(
        () => variantsState.treeId === activeTreeId && variantsState.id === id ? variantsState.value : [],
        [variantsState, activeTreeId, id],
    );
    const mediaLoading = !(mediaStatus.treeId === activeTreeId && mediaStatus.id === id && mediaStatus.loaded);
    const citationsLoading = !(citationStatus.treeId === activeTreeId && citationStatus.id === id && citationStatus.loaded);
    const variantsLoading = !(variantsStatus.treeId === activeTreeId && variantsStatus.id === id && variantsStatus.loaded);
    const currentCitationsError = citationsErrorScope?.treeId === activeTreeId && citationsErrorScope.id === id ? citationsError : null;
    const citationsReady = !currentCitationsError
        && citationStatus.treeId === activeTreeId
        && citationStatus.id === id
        && citationStatus.loaded;
    // Only show the skeleton when there is genuinely nothing to paint yet. A cache
    // hit (or a completed load) makes `activePerson` non-null, so no skeleton flashes
    // on back/related-person nav; the `loadedIdentity` term still lets a failed cold fetch
    // fall through to the "not found" state instead of an endless skeleton.
    const loading = (!activePerson && (loadedIdentity?.treeId !== activeTreeId || loadedIdentity?.id !== id)) || currentUserId === null;
    // Cold load (hard reload / deep link) is skeleton-first; a warm in-app nav keeps
    // the default 200ms grace.
    //
    // The grace exists so a fast in-app load (warm PGlite/DB query ~200ms) skips the
    // skeleton entirely instead of being force-padded to the 400ms minDuration floor.
    // That reasoning only holds when something is already cached — on a cold load
    // nothing is, the fetch is never that fast, and `pending` renders an empty div, so
    // the grace could ONLY ever produce a blank frame. Measured on a hosted hard reload
    // before this: 343ms blank → 115ms skeleton → content. (The Suspense fallback in
    // page.tsx does NOT cover this — the view renders server-side without suspending,
    // so its `pending` branch is what lands in the prerendered HTML.)
    //
    // Lazy useState (not a ref — reading `.current` during render is a lint error):
    // captured on first render so `delay` stays stable for the hook's lifetime rather
    // than flipping mid-load when the cache fills.
    const [coldLoad] = useState(() => !cachedPerson && !summary);
    const phase = useLoadPhase(loading, coldLoad ? { delay: 0 } : undefined);

    const fetchPerson = useCallback(async (): Promise<void> => {
        if (currentUserId === null) return;
        const request = ++personRequest.current;
        setPersonError(null);
        setPersonErrorScope(null);
        const cached = dataCache.get<PersonWithRelations>(personKey(activeTreeId, id));
        if (cached) {
            setPerson(cached);
            setPersonScope({ treeId: activeTreeId, id });
        }
        try {
            const loaded = await loadPerson(Number(id), activeTreeId);
            if (personRequest.current === request) {
                setPerson(loaded);
                setPersonScope({ treeId: activeTreeId, id });
            }
        } catch (e) {
            if (personRequest.current !== request || redirectIfUnauthorized(e)) return;
            if (e instanceof NotFoundError) {
                // Person detail owns its established not-found page. A deleted
                // cached record must not become a generic retry banner.
                setPerson(null);
                setPersonScope({ treeId: activeTreeId, id });
                setPersonError(null);
                setPersonErrorScope(null);
                return;
            }
            // Keep a cached/stale primary record visible while reporting the
            // failed revalidation. A cold failure remains distinguishable via
            // personError and the absent person value.
            setPersonError(tc(errorToastKey(e)));
            setPersonErrorScope({ treeId: activeTreeId, id });
        }
    }, [id, activeTreeId, currentUserId, redirectIfUnauthorized, tc]);

    const fetchMedia = useCallback(async () => {
        if (currentUserId === null) return;
        const request = ++mediaRequest.current;
        setMediaError(null);
        setMediaErrorScope(null);
        setMediaStatus({ treeId: activeTreeId, id, loaded: false });
        const cached = dataCache.get<PersonGalleryMedia[]>(mediaKey(activeTreeId, id));
        if (cached !== undefined) setMediaState({ treeId: activeTreeId, id, value: cached });
        try {
            const list = await loadPersonMedia(Number(id), activeTreeId);
            if (mediaRequest.current === request) {
                setMediaState({ treeId: activeTreeId, id, value: list });
                setMediaStatus({ treeId: activeTreeId, id, loaded: true });
            }
        } catch (e) {
            if (mediaRequest.current !== request || redirectIfUnauthorized(e)) return;
            // Empty media is a successful zero-row result; failed media stays
            // separate so the gallery can show its own retryable error.
            setMediaError(tc(errorToastKey(e)));
            setMediaErrorScope({ treeId: activeTreeId, id });
            if (mediaRequest.current === request) setMediaStatus({ treeId: activeTreeId, id, loaded: true });
        }
    }, [id, activeTreeId, currentUserId, redirectIfUnauthorized, tc]);

    const fetchCitations = useCallback(async () => {
        if (currentUserId === null) return;
        const request = ++citationsRequest.current;
        setCitationsError(null);
        setCitationsErrorScope(null);
        setCitationStatus({ treeId: activeTreeId, id, loaded: false });
        const cached = dataCache.get<CitationMap>(citationsKey(activeTreeId, id));
        if (cached) {
            setCitationState({ treeId: activeTreeId, id, value: cached });
        }
        try {
            const map = await loadPersonCitations(Number(id), activeTreeId);
            if (citationsRequest.current === request) {
                setCitationState({ treeId: activeTreeId, id, value: map });
                setCitationStatus({ treeId: activeTreeId, id, loaded: true });
            }
        } catch (e) {
            if (citationsRequest.current !== request || redirectIfUnauthorized(e)) return;
            setCitationsError(tc(errorToastKey(e)));
            setCitationsErrorScope({ treeId: activeTreeId, id });
            if (citationsRequest.current === request) setCitationStatus({ treeId: activeTreeId, id, loaded: true });
        }
    }, [id, activeTreeId, currentUserId, redirectIfUnauthorized, tc]);

    const fetchVariants = useCallback(async () => {
        if (currentUserId === null) return;
        const request = ++variantsRequest.current;
        setVariantsError(null);
        setVariantsErrorScope(null);
        setVariantsStatus({ treeId: activeTreeId, id, loaded: false });
        const cached = dataCache.get<NameVariant[]>(variantsKey(activeTreeId, id));
        if (cached) {
            setVariantsState({ treeId: activeTreeId, id, value: cached });
        }
        try {
            const list = await loadPersonVariants(Number(id), activeTreeId);
            if (variantsRequest.current === request) {
                setVariantsState({ treeId: activeTreeId, id, value: list });
                setVariantsStatus({ treeId: activeTreeId, id, loaded: true });
            }
        } catch (e) {
            if (variantsRequest.current !== request || redirectIfUnauthorized(e)) return;
            setVariantsError(tc(errorToastKey(e)));
            setVariantsErrorScope({ treeId: activeTreeId, id });
            if (variantsRequest.current === request) setVariantsStatus({ treeId: activeTreeId, id, loaded: true });
        }
    }, [id, activeTreeId, currentUserId, redirectIfUnauthorized, tc]);

    useEffect(() => {
        if (!id || currentUserId === null) return;
        let cancelled = false;
        // `person`/`loadedIdentity` were seeded synchronously from the cache above (SWR
        // instant paint — no skeleton, no flash of the previously-viewed person).
        // Here we just revalidate all four resources in the background and mark the
        // load done. On a cold load or right after an edit (the write cleared the
        // cache) the seed was null, so the skeleton-then-fetch path runs.
        // The fetchers setState after their awaits (and one synchronous cache-paint) —
        // the usual false positive for this rule.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        Promise.all([fetchPerson(), fetchMedia(), fetchCitations(), fetchVariants()])
            .finally(() => {
                if (!cancelled) setLoadedIdentity({ treeId: activeTreeId, id });
            });
        return () => { cancelled = true; };
    }, [id, activeTreeId, currentUserId, fetchPerson, fetchMedia, fetchCitations, fetchVariants]);

    useEffect(() => {
        scrollToTop();
    }, [id]);

    useDocumentTitle(activePerson ? fullName(activePerson, t('unknown')) : null);

    useEffect(() => {
        // By place id where the fact has one: two places may share a name (#1186).
        const keys = uniquePlaceKeys([
            factPlaceKey(activePerson?.BirthPlace, activePerson?.BirthPlaceId),
            factPlaceKey(activePerson?.DeathPlace, activePerson?.DeathPlaceId),
            ...((activePerson?.events ?? []).map(e => factPlaceKey(e.Place, e.PlaceId))),
        ]);
        if (keys.length === 0) return;
        let active = true;
        (async () => {
            try {
                const client = await getDataClient();
                // One batched lookup for all of this person's places, instead of a
                // per-place call to the heavy /api/places/detail endpoint (audit #4).
                const coords = await client.places.coords(keys, activeTreeId);
                if (active) setPlaceCoordsState({ treeId: activeTreeId, id, value: coords });
            } catch { /* maps are best-effort */ }
        })();
        // Don't wipe coords to {} here: on a refetch (e.g. person.events identity
        // changing after an edit) that caused a visible flash to empty before the
        // fresh coords arrived. The next successful load overwrites them; coords
        // for places the current person no longer has are simply never rendered.
        return () => { active = false; };
    }, [activePerson?.BirthPlace, activePerson?.BirthPlaceId, activePerson?.DeathPlace, activePerson?.DeathPlaceId, activePerson?.events, activeTreeId, id]);

    const placeCoords = placeCoordsState?.treeId === activeTreeId && placeCoordsState.id === id
        ? placeCoordsState.value
        : {};

    const citationsFor = useCallback((factTable: string, factId: number): CitationRow[] => {
        return activeCitationMap[`${factTable}:${factId}`] ?? [];
    }, [activeCitationMap]);

    const renderCitePin = useCallback((factTable: string, factId: number, factLabel: string, sourceNumbers: SourceNumbers) => {
        if (!isFactTableValue(factTable)) return null;
        const cites = citationsFor(factTable, factId);
        if (cites.length === 0) {
            // A viewer's pin opens Search records, which only reads (#1028).
            const viewer = activePermission === 'view';
            const onClick = citationsReady
                ? () => setAttachTarget({ factTable, factId, factLabel, initialView: viewer ? 'search' : 'add' })
                : undefined;
            return <Cite empty factLabel={factLabel} searchOnly={viewer} onClick={onClick} />;
        }
        return (
            <>
                {chipCitations(cites, sourceNumbers).map(c => (
                    <Cite
                        key={c.Id}
                        n={sourceNumbers.get(c.SourceId)}
                        sourceTitle={c.sourceTitle ?? undefined}
                        onClick={(anchor) => setCitationPreview({
                            anchor,
                            citation: c,
                            fact: { factTable, factId, label: factLabel, value: factLabel, citations: cites },
                        })}
                    />
                ))}
                {activePermission !== 'view' && citationsReady && (
                    <Cite more factLabel={factLabel} onClick={() => setAttachTarget({ factTable, factId, factLabel, initialView: 'add' })} />
                )}
            </>
        );
    }, [citationsFor, activePermission, citationsReady]);

    return {
        id,
        activeTreeId,
        activePermission,
        person: activePerson,
        summary,
        setPerson,
        media,
        citationMap: activeCitationMap,
        variants: activeVariants,
        mediaLoading,
        citationsLoading,
        variantsLoading,
        personError: personErrorScope?.treeId === activeTreeId && personErrorScope.id === id ? personError : null,
        mediaError: mediaErrorScope?.treeId === activeTreeId && mediaErrorScope.id === id ? mediaError : null,
        citationsError: currentCitationsError,
        citationsReady,
        variantsError: variantsErrorScope?.treeId === activeTreeId && variantsErrorScope.id === id ? variantsError : null,
        placeCoords,
        phase,
        showDescendants,
        setShowDescendants,
        attachTarget,
        setAttachTarget,
        citationPreview,
        setCitationPreview,
        showInlineEvent,
        setShowInlineEvent,
        showUpload,
        setShowUpload,
        showJourney,
        setShowJourney,
        fetchPerson,
        fetchMedia,
        fetchCitations,
        fetchVariants,
        // Re-fetch name variants (client.people.listNameVariants) and re-set state.
        // `fetchVariants` already writes the fresh result back into `dataCache` at
        // `variantsKey`, overwriting whatever was cached before the mutation — the
        // caller (PersonDetailView) calls this after add/rename/remove/set-primary
        // so the panel reflects the change without a full page reload.
        refreshVariants: fetchVariants,
        citationsFor,
        renderCitePin,
    };
}
