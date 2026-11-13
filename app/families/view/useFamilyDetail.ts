'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTree } from '@/app/contexts/TreeContext';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import { useToggleSet } from '@/app/hooks/useToggleSet';
import type { Person, SpouseRelation, GedcomEvent, FamilyType, Media } from '@/lib/db/schema';
import type { Citation } from '@/lib/db/queries/citations';
import type { FactTableValue } from '@/lib/db/fact-tables';
import type { CitationPreviewTarget } from '@/app/components/citations/types';
import { getDataClient } from '@/lib/data';
import { dataCache } from '@/lib/data/cache';
import { errorToastKey, isRecordGone } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import {
    familyKey, partnerFamiliesKey, familyCitationsKey,
    loadFamily, loadPartnerFamilies, loadFamilyCitations,
    getFamilySummary,
} from './familyCache';
import { partnerName } from './derive';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { factPlaceKey, uniquePlaceKeys } from '@/lib/places/place-key';

/**
 * A person as the family-detail read returns them: the `Person` columns plus the
 * primary-photo join, the two computed display columns (`EffectiveFirstName`,
 * `Nickname` — see PersonDisplay in schema.ts), and, for children, the
 * `FamilyPerson` relationship columns carried by the join. All optional because
 * the same type covers partners (no relationships) and children alike.
 */
export interface PartnerPerson extends Person {
    PrimaryMediaId?: number;
    FocalX?: number;
    FocalY?: number;
    FocalRadius?: number | null;
    EffectiveFirstName?: string | null;
    Nickname?: string | null;
    /** Children only: the child's relationship to Partner1 / Partner2 (#982). */
    Partner1Relationship?: string | null;
    Partner2Relationship?: string | null;
}

export interface FamilyDetailsResponse {
    family: {
        Id: number;
        Partner1Id: number | null;
        Partner2Id: number | null;
        MarriageDate: string | null;
        MarriagePlace: string | null;
        /** The place the marriage points at (#1186): two places may share its name. */
        MarriagePlaceId?: number | null;
        Type: FamilyType | null;
    };
    husband: PartnerPerson | null;
    wife: PartnerPerson | null;
    children: PartnerPerson[];
    /** Family-level events (divorce/annulment/engagement/…) for the timeline. */
    events?: GedcomEvent[];
    /** The marriage's own photos (ADR 0030), for the timeline's start row. */
    marriageMedia?: Media[];
    /** The children's adoption events (#485), for the timeline. */
    childAdoptions?: GedcomEvent[];
    /** The family photo (#119); without one the cover shows the split portrait. */
    photo?: Media | null;
}

export type CitationRow = Citation;
export type CitationMap = Record<string, Citation[]>;

export interface PartnerFamilies {
    person: Person | null;
    /** Resolved partnerships for this person — each carries the OTHER partner + family. */
    spouses: SpouseRelation[];
}

export type AttachTarget = { factTable: FactTableValue; factId: number; factLabel: string; initialCitationId?: number; initialView?: 'attached' | 'add' | 'editor' | 'search' };

export function useFamilyDetail() {
    const familyId = useSearchParams().get('id') ?? '';
    const t = useTranslations('families');
    const tc = useTranslations('common');
    const { activeTreeId, activePermission, currentUserId } = useTree();
    const { redirectIfUnauthorized } = useErrorToast();

    // Synchronously resolve the cached record for the current id on every render.
    // On a revisit (cross-route remount) or a related-family nav (same-route ?id
    // change) this lets the page paint the family immediately — no skeleton, and no
    // flash of the previously-viewed family. A cold load (cache miss) falls through
    // to the skeleton-first path below. Any write clears the whole cache
    // (withCacheInvalidation), so a post-edit revisit correctly misses and refetches.
    const cacheKey = familyId ? familyKey(activeTreeId, familyId) : null;
    const cachedDetails = cacheKey ? dataCache.get<FamilyDetailsResponse>(cacheKey) ?? null : null;
    // Lightweight partnership summary (from a previously-loaded families list). When
    // the full record isn't cached yet, the view paints the hero from this instead of
    // a blank while `families.get` resolves.
    const summary = getFamilySummary(familyId, activeTreeId);

    const [details, setDetails] = useState<FamilyDetailsResponse | null>(cachedDetails);
    const [detailsScope, setDetailsScope] = useState<{ treeId: number | null; id: string } | null>(
        cachedDetails ? { treeId: activeTreeId, id: familyId } : null,
    );
    const [error, setError] = useState<string | null>(null);
    const [errorKey, setErrorKey] = useState<string | null>(null);
    // A missing family is its own state, not a retryable error (#697).
    const [notFoundKey, setNotFoundKey] = useState<string | null>(null);
    const [partner1Families, setPartner1Families] = useState<PartnerFamilies | null>(null);
    const [partner2Families, setPartner2Families] = useState<PartnerFamilies | null>(null);
    const [partner1Key, setPartner1Key] = useState<string | null>(null);
    const [partner2Key, setPartner2Key] = useState<string | null>(null);
    const [partner1Error, setPartner1Error] = useState<string | null>(null);
    const [partner2Error, setPartner2Error] = useState<string | null>(null);
    const [partner1ErrorKey, setPartner1ErrorKey] = useState<string | null>(null);
    const [partner2ErrorKey, setPartner2ErrorKey] = useState<string | null>(null);
    const [citationMap, setCitationMap] = useState<CitationMap>({});
    const [citationKey, setCitationKey] = useState<string | null>(null);
    const [citationError, setCitationError] = useState<string | null>(null);
    const [citationErrorKey, setCitationErrorKey] = useState<string | null>(null);
    const [loadedIdentity, setLoadedIdentity] = useState<{ treeId: number | null; id: string } | null>(
        cachedDetails ? { treeId: activeTreeId, id: familyId } : null,
    );
    const [showInlineEvent, setShowInlineEvent] = useState(false);
    const [attachTarget, setAttachTarget] = useState<AttachTarget | null>(null);
    const [citationPreview, setCitationPreview] = useState<CitationPreviewTarget | null>(null);
    const [placeCoords, setPlaceCoords] = useState<{ treeId: number | null; id: string; value: Record<string, { lat: number; lng: number }> } | null>(null);
    const { isOpen, toggle } = useToggleSet();
    const familyRequest = useRef(0);
    const partner1Request = useRef(0);
    const partner2Request = useRef(0);
    const citationRequest = useRef(0);

    const fetchPartner = useCallback(async (
        personId: number | null,
        requestRef: { current: number },
        setValue: (value: PartnerFamilies | null) => void,
        setValueKey: (value: string | null) => void,
        setRegionError: (value: string | null) => void,
        setRegionErrorKey: (value: string | null) => void,
    ) => {
        const request = ++requestRef.current;
        if (!personId) {
            setValue(null);
            setValueKey(null);
            setRegionError(null);
            setRegionErrorKey(null);
            return;
        }
        const key = partnerFamiliesKey(activeTreeId, personId);
        setRegionError(null);
        setRegionErrorKey(null);
        const cached = dataCache.get<PartnerFamilies>(key);
        if (cached) {
            setValue(cached);
            setValueKey(key);
        }
        const result = await loadPartnerFamilies(personId, activeTreeId);
        if (requestRef.current !== request) return;
        if (result.error) {
            if (redirectIfUnauthorized(result.error)) return;
            setRegionError(tc(errorToastKey(result.error)));
            setRegionErrorKey(key);
            return;
        }
        setValue(result);
        setValueKey(key);
    }, [activeTreeId, redirectIfUnauthorized, tc]);

    const fetchPartner1 = useCallback((personId: number | null) => fetchPartner(
        personId, partner1Request, setPartner1Families, setPartner1Key,
        setPartner1Error, setPartner1ErrorKey,
    ), [fetchPartner]);

    const fetchPartner2 = useCallback((personId: number | null) => fetchPartner(
        personId, partner2Request, setPartner2Families, setPartner2Key,
        setPartner2Error, setPartner2ErrorKey,
    ), [fetchPartner]);

    const fetchCitations = useCallback(async (targetFamilyId: string = familyId) => {
        const request = ++citationRequest.current;
        const key = familyCitationsKey(activeTreeId, targetFamilyId);
        setCitationError(null);
        setCitationErrorKey(null);
        const cached = dataCache.get<CitationMap>(key);
        if (cached) {
            setCitationMap(cached);
            setCitationKey(key);
        }
        try {
            const map = await loadFamilyCitations(Number(targetFamilyId), activeTreeId);
            if (citationRequest.current !== request) return;
            setCitationMap(map);
            setCitationKey(key);
        } catch (e) {
            if (citationRequest.current !== request || redirectIfUnauthorized(e)) return;
            setCitationError(tc(errorToastKey(e)));
            setCitationErrorKey(key);
        }
    }, [familyId, activeTreeId, redirectIfUnauthorized, tc]);

    const fetchFamily = useCallback(async () => {
        if (currentUserId === null) return;
        const request = ++familyRequest.current;
        setError(null);
        setErrorKey(null);
        setNotFoundKey(null);

        // Cache-first paint (SWR): seed the family + its right-rail resources from the
        // cache synchronously, then revalidate in the background below. Keeps a
        // same-route ?id change from momentarily showing the previous family.
        const cached = dataCache.get<FamilyDetailsResponse>(familyKey(activeTreeId, familyId));
        if (cached) {
            setDetails(cached);
            setDetailsScope({ treeId: activeTreeId, id: familyId });
            if (cached.family.Partner1Id) {
                const key = partnerFamiliesKey(activeTreeId, cached.family.Partner1Id);
                const value = dataCache.get<PartnerFamilies>(key);
                if (value) { setPartner1Families(value); setPartner1Key(key); }
            }
            if (cached.family.Partner2Id) {
                const key = partnerFamiliesKey(activeTreeId, cached.family.Partner2Id);
                const value = dataCache.get<PartnerFamilies>(key);
                if (value) { setPartner2Families(value); setPartner2Key(key); }
            }
            const cc = dataCache.get<CitationMap>(familyCitationsKey(activeTreeId, familyId));
            if (cc) {
                setCitationMap(cc);
                setCitationKey(familyCitationsKey(activeTreeId, familyId));
            }
        }

        try {
            const data = await loadFamily(Number(familyId), activeTreeId);
            if (familyRequest.current !== request) return;
            if (!data?.family) {
                setNotFoundKey(familyKey(activeTreeId, familyId));
                return;
            }
            setDetails(data);
            setDetailsScope({ treeId: activeTreeId, id: familyId });

            await Promise.all([
                fetchPartner1(data.family.Partner1Id),
                fetchPartner2(data.family.Partner2Id),
                fetchCitations(familyId),
            ]);
        } catch (err) {
            if (familyRequest.current !== request || redirectIfUnauthorized(err)) return;
            if (isRecordGone(err)) {
                setNotFoundKey(familyKey(activeTreeId, familyId));
                return;
            }
            setError(tc(errorToastKey(err)));
            setErrorKey(familyKey(activeTreeId, familyId));
        }
    }, [familyId, activeTreeId, currentUserId, tc, redirectIfUnauthorized, fetchPartner1, fetchPartner2, fetchCitations]);

    useEffect(() => {
        if (!familyId || currentUserId === null) return;
        let cancelled = false;
        // `details`/`loadedId` were seeded synchronously from the cache above (SWR
        // instant paint — no skeleton, no flash of the previously-viewed family).
        // Here we just revalidate in the background and mark the load done. On a cold
        // load or right after an edit (the write cleared the cache) the seed was null,
        // so the skeleton-then-fetch path runs.
        // The fetcher setStates after its awaits (and one synchronous cache-paint) —
        // the usual false positive for this rule.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchFamily().finally(() => {
            if (!cancelled) setLoadedIdentity({ treeId: activeTreeId, id: familyId });
        });
        return () => { cancelled = true; };
    }, [familyId, activeTreeId, currentUserId, fetchFamily]);

    const titleP1 = details ? partnerName(details.husband) : '';
    const titleP2 = details ? partnerName(details.wife) : '';
    useDocumentTitle(details
        ? ((titleP1 || titleP2) ? (titleP1 && titleP2 ? `${titleP1} & ${titleP2}` : titleP1 || titleP2) : t('family_fallback'))
        : null);

    const familyChildren = details?.children;
    const marriagePlace = details?.family.MarriagePlace;
    const marriagePlaceId = details?.family.MarriagePlaceId;
    const familyEvents = details?.events;
    useEffect(() => {
        // By place id where the fact has one: two places may share a name (#1186).
        const keys = uniquePlaceKeys([
            factPlaceKey(marriagePlace, marriagePlaceId),
            ...(familyEvents ?? []).map(e => factPlaceKey(e.Place, e.PlaceId)),
            ...(familyChildren ?? []).flatMap(c => [factPlaceKey(c.BirthPlace, c.BirthPlaceId), factPlaceKey(c.DeathPlace, c.DeathPlaceId)]),
        ]);
        if (keys.length === 0) return;
        let active = true;
        (async () => {
            try {
                const client = await getDataClient();
                // One batched lookup for all of this family's places, instead of a
                // per-place call to the heavy /api/places/detail endpoint (matches the
                // person-detail page).
                const coords = await client.places.coords(keys, activeTreeId);
                if (active) setPlaceCoords({ treeId: activeTreeId, id: familyId, value: coords });
            } catch { /* best-effort */ }
        })();
        // Don't wipe coords to {} on dep-change: that caused a visible flash to empty
        // before fresh coords arrived. LocationMap only renders places the current
        // family has, so stale coords for other places are simply never shown.
        return () => { active = false; };
    }, [marriagePlace, marriagePlaceId, familyEvents, familyChildren, activeTreeId, familyId]);

    // Prefer the state record for the current id; otherwise the freshly-cached one —
    // keeps a same-route ?id change from momentarily showing the previous family.
    const activeDetails = details
        && detailsScope?.treeId === activeTreeId
        && detailsScope.id === familyId
        && String(details.family.Id) === familyId
        ? details
        : cachedDetails;
    const expectedPartner1Key = activeDetails?.family.Partner1Id
        ? partnerFamiliesKey(activeTreeId, activeDetails.family.Partner1Id)
        : null;
    const expectedPartner2Key = activeDetails?.family.Partner2Id
        ? partnerFamiliesKey(activeTreeId, activeDetails.family.Partner2Id)
        : null;
    const expectedCitationKey = familyCitationsKey(activeTreeId, familyId);
    // Only show the skeleton when there is genuinely nothing to paint yet. A cache
    // hit (or a completed load) makes `activeDetails` non-null, so no skeleton flashes
    // on back/related-family nav; the `loadedId` term lets a failed cold fetch fall
    // through to the "not found" state instead of an endless skeleton.
    const loading = (!activeDetails && (loadedIdentity?.treeId !== activeTreeId || loadedIdentity.id !== familyId)) || currentUserId === null;
    // Cold load (hard reload / deep link) is skeleton-first; a warm in-app nav keeps
    // the default 200ms grace, which lets a fast load (warm PGlite/DB query ~200ms)
    // skip the skeleton instead of flashing it. That reasoning only holds when
    // something is cached — on a cold load `pending` renders an empty div, so the
    // grace could only ever produce a blank frame (measured: 277ms blank → content,
    // skeleton never shown). Matches the person-detail page.
    // Lazy useState, frozen on first render (a ref would be a `refs during render` lint error).
    const [coldLoad] = useState(() => !cachedDetails && !summary);
    const phase = useLoadPhase(loading, coldLoad ? { delay: 0 } : undefined);

    return {
        familyId,
        details: activeDetails,
        summary,
        error: errorKey === familyKey(activeTreeId, familyId) ? error : null,
        notFound: notFoundKey === familyKey(activeTreeId, familyId),
        phase,
        partner1Families: partner1Key === expectedPartner1Key ? partner1Families : null,
        partner2Families: partner2Key === expectedPartner2Key ? partner2Families : null,
        partner1Error: partner1ErrorKey === expectedPartner1Key ? partner1Error : null,
        partner2Error: partner2ErrorKey === expectedPartner2Key ? partner2Error : null,
        retryPartner1: () => fetchPartner1(activeDetails?.family.Partner1Id ?? null),
        retryPartner2: () => fetchPartner2(activeDetails?.family.Partner2Id ?? null),
        citationMap: citationKey === expectedCitationKey ? citationMap : {},
        citationError: citationErrorKey === expectedCitationKey ? citationError : null,
        citationsReady: citationKey === expectedCitationKey && citationErrorKey !== expectedCitationKey,
        retryCitations: () => fetchCitations(familyId),
        showInlineEvent,
        setShowInlineEvent,
        attachTarget,
        setAttachTarget,
        citationPreview,
        setCitationPreview,
        placeCoords: placeCoords?.treeId === activeTreeId && placeCoords.id === familyId ? placeCoords.value : {},
        isOpen,
        toggle,
        fetchFamily,
        activeTreeId,
        activePermission,
    };
}
