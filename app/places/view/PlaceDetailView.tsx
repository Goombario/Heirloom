'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTree } from '@/app/contexts/TreeContext';
import { getDataClient } from '@/lib/data';
import { displayFullName } from '@/lib/utils/names';
import { dataCache } from '@/lib/data/cache';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import LocationMap from '@/app/components/LocationMap';
import { Card } from '@/app/components/ui/Card';
import { Badge } from '@/app/components/ui/Badge';
import { Button } from '@/app/components/ui/Button';
import PersonAvatar from '@/app/components/PersonAvatar';
import { initialsFromName } from '@/lib/utils/initials';
import { warmThumbnails } from '@/lib/media/warmThumbnails';
import { PageShell, DetailHero, HeroEditButton, DetailRail, SectionHeader, InlineDataError, Lifespan, showErrorToast, showSuccessToast } from '@/app/components/ui';
import { MapPin, Pencil, ChevronRight, X, Check } from '@/lib/icons';
import PlaceEditFields, { parseCoords } from './PlaceEditFields';
import PlaceDetailSkeleton from './PlaceDetailSkeleton';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { OwnerNotesCard, NoteCount } from '@/app/components/notes/OwnerNotesCard';
import { placeRoleLabel } from '@/lib/places/placeRole';
import { placeDetailKey, usePrefetchPlaceDetail } from '@/lib/places/prefetch';
import { placeHref, type PlaceKey } from '@/lib/places/place-key';
import { parseIdParam } from '@/lib/utils/parse-id';
import { eventTypeLabel } from '@/lib/places/eventTypes';
import { PinMark } from '../PinMark';
import { chainFromCandidate, type PhotonCandidate } from '@/lib/geocode/photon';
import type { PlaceDetail } from '@/lib/data/types';
import RecordNotFound from '@/app/components/RecordNotFound';
import { isMissingPlace } from './missingPlace';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { MobilePlacePage, MobilePlaceSkeleton } from './mobile/MobilePlacePage';
import { MoveRecordsDialog } from './MoveRecords';
import { PlaceInUseHint, placeUnused } from './PlaceInUse';
import {
    OtherNamesCard, OtherNamesEditor, OtherNamesSubtitle, RenameChoices, blankDraft, draftsBlocked, draftsChanged, draftsFor, draftsToSave,
    type NameDraft, type RenameChoice,
} from './OtherNames';
import { buildPlaceNameIndex, mergeTargetNames, type PlaceNameIndex } from '@/lib/places/other-names';
import { recordedAsByPerson } from './recordedAs';
import { ValidationError } from '@/lib/validation';


/** Connected people listed before the "Show all" row. */
const PEOPLE_PAGE = 12;

/** Avatar diameter in the connected-people list — also the width the thumbnail
 *  warm targets, so the prefetch and the render ask for the same variant. */
const PERSON_AVATAR_SIZE = 36;

// Owner-scoped cache key for a place-detail payload (see lib/places/prefetch.ts —
// single source of truth, shared with the hover/focus prefetch). Served from the
// shared dataCache for instant back-navigation; any write clears the whole cache
// (withCacheInvalidation), so the post-save refetch always misses and fetches
// fresh — no stale detail after an edit (audit #13).

export default function PlaceDetailClient() {
    // A place is addressed by id (#1186); `?name=` still opens the place a name
    // names (old links, another of its names) and is replaced by its id once loaded.
    const searchParams = useSearchParams();
    const placeIdParam = parseIdParam(searchParams.get('id'));
    const nameParam = searchParams.get('name') ?? '';
    // "Merge X into Y" from another place's names (#1185) opens this place's rename
    // with Y typed and the old name kept.
    const renameParam = searchParams.get('rename');
    const keepParam = searchParams.get('keep') === '1';
    const placeKey: PlaceKey = placeIdParam ?? nameParam;
    const router = useRouter();
    const t = useTranslations('places');
    const tc = useTranslations('common');
    const tNotes = useTranslations('notes');
    const { activeTreeId, activePermission, currentUserId } = useTree();
    const { redirectIfUnauthorized } = useErrorToast();
    const prefetchPlace = usePrefetchPlaceDetail();
    const scopeKey = placeDetailKey(activeTreeId, placeKey);
    const scopeRef = useRef({ key: scopeKey, generation: 0 });
    if (scopeRef.current.key !== scopeKey) {
        scopeRef.current = { key: scopeKey, generation: scopeRef.current.generation + 1 };
    }
    const mutationGeneration = useRef(0);
    const otherPlacesRequest = useRef(0);
    const [detailState, setDetail] = useState<PlaceDetail | null>(null);
    const [detailKey, setDetailKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    // Boolean, not the resolved message: keeping `t` out of fetchDetail's deps
    // stops the LanguageProvider's post-mount en→fr/ru swap from changing the
    // callback identity and re-running the expensive detail query (audit #11).
    const [loadError, setLoadError] = useState(false);
    const [loadErrorKey, setLoadErrorKey] = useState<string | null>(null);
    const detailRequest = useRef(0);

    // Inline edit state (coordinates + name persist; modern-name/aliases are inert).
    const [editing, setEditing] = useState(false);
    const [coordsInput, setCoordsInput] = useState('');
    const [coordsError, setCoordsError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [noteCount, setNoteCount] = useState(0);

    // Rename / merge state (CRUD §1.2).
    const [nameInput, setNameInput] = useState('');
    const [otherPlaces, setOtherPlaces] = useState<string[]>([]);
    const [renaming, setRenaming] = useState(false);
    // A re-match write is in flight (#447).
    const [rematching, setRematching] = useState(false);
    // Pending rename awaiting confirmation; null when no dialog.
    const [pendingRename, setPendingRename] = useState<{ to: string; isMerge: boolean } & RenameChoice | null>(null);
    // Keep the old name / keep two same-name places apart (#1185).
    const [renameChoice, setRenameChoice] = useState<RenameChoice>({ keepOld: false, separate: false });
    // The other names as edited (#1185), and every other place's names for their checks.
    const [nameDrafts, setNameDrafts] = useState<NameDraft[]>([]);
    const [nameIndex, setNameIndex] = useState<PlaceNameIndex | null>(null);
    // "Move records to another place" is open (#1186).
    const [movingRecords, setMovingRecords] = useState(false);
    // Deleting an unused place (#1229): the confirm is open, and the delete is in flight.
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    type MutationToken = { key: string; scopeGeneration: number; mutationGeneration: number };
    const beginMutation = useCallback((): MutationToken => ({
        key: scopeRef.current.key,
        scopeGeneration: scopeRef.current.generation,
        mutationGeneration: ++mutationGeneration.current,
    }), []);
    const isCurrentMutation = useCallback((token: MutationToken) => (
        token.key === scopeRef.current.key
        && token.scopeGeneration === scopeRef.current.generation
        && token.mutationGeneration === mutationGeneration.current
    ), []);

    // Edit affordance is permission-gated (hidden on view permission).
    const detail = detailKey === scopeKey ? detailState : null;
    const placeName = detail?.name ?? nameParam;
    const visibleLoadError = loadErrorKey === scopeKey && loadError;
    const canEdit = detail !== null && activePermission != null && activePermission !== 'view';
    const canDelete = activePermission === 'owner' || activePermission === 'edit';

    // Ref for the desktop Edit button — used to return focus when edit closes.
    const editButtonContainerRef = useRef<HTMLSpanElement | null>(null);
    // Track previous editing state so we only refocus after an edit-close transition.
    const wasEditingRef = useRef(false);

    // A place/tree switch invalidates all transient edit state and in-flight
    // completions. The replacement detail must never inherit an old place's
    // coordinates, rename confirmation, datalist, busy flags, or focus target.
    useEffect(() => {
        detailRequest.current++;
        otherPlacesRequest.current++;
        mutationGeneration.current++;
        setEditing(false);
        setCoordsInput('');
        setCoordsError(null);
        setSaving(false);
        setSaveError(null);
        setNameInput('');
        setOtherPlaces([]);
        setRenaming(false);
        setRematching(false);
        setPendingRename(null);
        setRenameChoice({ keepOld: false, separate: false });
        setNameDrafts([]);
        setNameIndex(null);
        setMovingRecords(false);
        setNoteCount(0);
        wasEditingRef.current = false;
    }, [scopeKey]);

    const fetchDetail = useCallback(async () => {
        if (currentUserId === null) return;
        const request = ++detailRequest.current;
        const key = placeDetailKey(activeTreeId, placeKey);
        const scopeGeneration = scopeRef.current.generation;
        const isCurrent = () => (
            detailRequest.current === request
            && scopeRef.current.key === key
            && scopeRef.current.generation === scopeGeneration
        );
        // Stale-while-revalidate: paint the cached payload instantly on a hit
        // (no skeleton), then revalidate. On a save the cache was just cleared,
        // so this misses and shows the skeleton while fetching fresh.
        const cached = dataCache.get<PlaceDetail>(key);
        if (!isCurrent()) return;
        if (cached) {
            setDetail(cached);
            setDetailKey(key);
            setLoadError(false);
            setLoadErrorKey(null);
            setLoading(false);
        } else {
            setLoading(true);
        }
        try {
            const client = await getDataClient();
            if (!isCurrent()) return;
            const data = await client.places.detail(placeKey, activeTreeId);
            if (!isCurrent()) return;
            dataCache.set(key, data);
            // Opened by name: the id URL it is about to move to paints from cache.
            if (data.id != null) dataCache.set(placeDetailKey(activeTreeId, data.id), data);
            setDetail(data);
            setDetailKey(key);
            setLoadError(false);
            setLoadErrorKey(null);
        } catch (e) {
            if (!isCurrent()) return;
            if (redirectIfUnauthorized(e)) return;
            setLoadError(true);
            setLoadErrorKey(key);
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [placeKey, activeTreeId, currentUserId, redirectIfUnauthorized]);

    useEffect(() => { fetchDetail(); }, [fetchDetail]);

    // A place opened by a name (an old link, or a fact recorded as "Lemberg") moves
    // to its id, so a rename or edit here acts on that place (#1167, #1186).
    const loadedId = detail?.id;
    useEffect(() => {
        if (loadedId != null && placeIdParam == null) router.replace(placeHref({ id: loadedId, name: '' }));
    }, [loadedId, placeIdParam, router]);

    // Warm the connected-people thumbnails as soon as the payload lands, so the
    // avatars paint from cache instead of showing their initials placeholder
    // while each row's lazy <img> starts from cold. The whole list ships in one
    // fetch, so this work overlaps the render rather than trailing it.
    useEffect(() => {
        if (!detail) return;
        warmThumbnails(
            detail.people.map((p) => ({ mediaId: p.PrimaryMediaId, focalRadius: p.FocalRadius })),
            { containerWidth: PERSON_AVATAR_SIZE, treeId: activeTreeId },
        );
    }, [detail, activeTreeId]);

    useDocumentTitle(placeName);

    const totalCount = detail ? detail.people.length + detail.eventCount + detail.familyCount : 0;
    const recordedNames = useMemo(() => (detail ? recordedAsByPerson(detail) : new Map<number, string>()), [detail]);
    const peopleCount = detail?.people.length ?? 0;
    // A busy place listed everyone in one column (74 people made the page 4,938px
    // tall), so the list shows a first page and a "Show all" row (#765, LY-3).
    // Keyed to the place, so following a "Part of" link starts collapsed again.
    const [showAllPeopleFor, setShowAllPeopleFor] = useState<string | null>(null);
    const visiblePeople = !detail ? [] : showAllPeopleFor === scopeKey ? detail.people : detail.people.slice(0, PEOPLE_PAGE);
    const hiddenPeople = peopleCount - visiblePeople.length;
    const geocoded = detail != null && detail.latitude != null && detail.longitude != null;

    // Localize the server-aggregated per-type event counts for the right-rail
    // "Events here" card, folding marriages in as MARR.
    const eventCounts = useMemo(() => {
        if (!detail) return [] as { type: string; label: string; count: number }[];
        const tally = new Map<string, number>();
        for (const e of detail.eventCounts) {
            tally.set(e.type, (tally.get(e.type) ?? 0) + e.count);
        }
        // Marriages arrive as a family count, not event rows.
        if (detail.familyCount > 0) {
            tally.set('MARR', (tally.get('MARR') ?? 0) + detail.familyCount);
        }
        return Array.from(tally.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => ({ type, label: eventTypeLabel(type, t), count }));
    }, [detail, t]);

    // While editing, the map shows the EDIT BUFFER, not the saved row: typing coordinates
    // moves the pin, and dragging the pin writes them back (#566). Debounced, because the
    // buffer changes on every keystroke and a half-typed "51.1, " is not a position.
    // Unparseable input leaves the pin where it was rather than dropping it off the map.
    // The LAST POINT the buffer parsed to, not the buffer itself: an unparseable value
    // leaves the pin where it was. Storing the string instead let a half-typed "51.1, "
    // drop the marker — and on a place with no saved coordinates that unmounted the whole
    // map, so every keystroke through an invalid state paid a full re-init and tile fetch.
    const [editPoint, setEditPoint] = useState<{ lat: number; lng: number } | null>(null);
    useEffect(() => {
        if (!editing) { setEditPoint(null); return; }
        const id = setTimeout(() => {
            const parsed = parseCoords(coordsInput);
            if (parsed) setEditPoint({ lat: parsed.latitude, lng: parsed.longitude });
        }, 250);
        return () => clearTimeout(id);
    }, [editing, coordsInput]);
    const mapPoint = useMemo(() => {
        if (editPoint) return editPoint;
        if (detail?.latitude != null && detail.longitude != null) {
            return { lat: detail.latitude, lng: detail.longitude };
        }
        if (detail?.inheritedFrom) {
            return { lat: detail.inheritedFrom.lat, lng: detail.inheritedFrom.lng };
        }
        return null;
    }, [editPoint, detail?.latitude, detail?.longitude, detail?.inheritedFrom]);
    // No pin of its own: the geocoded places below it, fitted on one map (#923),
    // until an edit types a coordinate of its own.
    const descendantMarkers = useMemo(
        () => (editPoint ? [] : (detail?.descendantPins ?? []).map((p) => ({
            lat: p.lat, lng: p.lng, label: p.name.split(',')[0]?.trim() || p.name,
        }))),
        [editPoint, detail?.descendantPins],
    );

    // A drag is a manual refinement of the pin, not a new geocode: it writes the field and
    // nothing else, at 4dp (~11m — finer than a dragged pin can claim to be).
    const handlePinDrag = useCallback((lat: number, lng: number) => {
        if (scopeRef.current.key !== scopeKey) return;
        setCoordsInput(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        setCoordsError(null);
    }, [scopeKey]);

    // The pin no longer sits where the geocoder put it. Not an error — DisplayName records
    // WHICH place was matched, and moving off a town centroid onto the actual churchyard is
    // the common case — but it must not be silent.
    const pinAdjusted = useMemo(() => {
        if (!editing || !detail?.displayName) return false;
        const parsed = parseCoords(coordsInput);
        if (!parsed || detail.latitude == null || detail.longitude == null) return false;
        return parsed.latitude !== detail.latitude || parsed.longitude !== detail.longitude;
    }, [editing, coordsInput, detail?.displayName, detail?.latitude, detail?.longitude]);

    const placeShort = placeName.split(',')[0]?.trim() ?? placeName;
    // delay: 0 — skeleton-first, now that there IS a skeleton (#392). The detail
    // payload is a multi-join rollup query and a hard reload reliably outruns the
    // default 200ms `pending` window, so that window only bought a blank frame
    // before the placeholder. Matches /places (app/places/page.tsx:74).
    const phase = useLoadPhase(loading || (detailKey !== scopeKey && !visibleLoadError), { delay: 0 });

    const savedCoords = detail && detail.latitude != null && detail.longitude != null
        ? `${detail.latitude}, ${detail.longitude}`
        : '';
    const handleEdit = useCallback((start?: { rename?: string; keepOld?: boolean }) => {
        const editScopeGeneration = scopeRef.current.generation;
        if (scopeRef.current.key !== scopeKey) return;
        setCoordsInput(savedCoords);
        setCoordsError(null);
        setSaveError(null);
        setNameInput(start?.rename ?? placeName);
        setRenameChoice({ keepOld: start?.keepOld ?? false, separate: false });
        setOtherPlaces([]);
        setNameIndex(null);
        // With no other names yet, the group opens on one empty name to fill in.
        const drafts = draftsFor(detail?.otherNames);
        setNameDrafts(drafts.length > 0 ? drafts : [blankDraft()]);
        setEditing(true);
        // Load the other place names for the merge datalist (best-effort).
        if (currentUserId !== null) {
            const request = ++otherPlacesRequest.current;
            getDataClient()
                .then((client) => client.places.list(activeTreeId))
                .then((list) => {
                    if (
                        otherPlacesRequest.current !== request
                        || scopeRef.current.key !== scopeKey
                        || scopeRef.current.generation !== editScopeGeneration
                    ) return;
                    setOtherPlaces(mergeTargetNames(list, placeName));
                    setNameIndex(buildPlaceNameIndex(list, detail?.id ?? null));
                })
                .catch(() => { /* datalist is optional — a failure just omits suggestions; the server still checks names */ });
        }
    }, [detail, placeName, savedCoords, activeTreeId, currentUserId, scopeKey]);

    const handleCancel = useCallback(() => {
        if (scopeRef.current.key !== scopeKey) return;
        setEditing(false);
        setCoordsError(null);
        setSaveError(null);
    }, [scopeKey]);

    // "Merge X into Y" (#1185) lands here with the rename typed: open it once, then
    // drop the request from the URL. Phones open their rename sheet instead.
    const [phoneRename, setPhoneRename] = useState<{ to: string; keepOld: boolean } | null>(null);
    const startedRename = useRef<string | null>(null);
    useEffect(() => {
        if (!renameParam || !canEdit || detail?.id == null || startedRename.current === scopeKey) return;
        startedRename.current = scopeKey;
        const start = { rename: renameParam, keepOld: keepParam };
        if (window.matchMedia('(max-width: 767px)').matches) setPhoneRename({ to: renameParam, keepOld: keepParam });
        else handleEdit(start);
        router.replace(placeHref({ id: detail.id, name: '' }));
    }, [renameParam, keepParam, canEdit, detail?.id, scopeKey, handleEdit, router]);

    // Esc cancels edit when the edit panel is open.
    useEffect(() => {
        if (!editing) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleCancel();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [editing, handleCancel]);

    // Return focus to the Edit button after the edit panel closes.
    useEffect(() => {
        if (!editing && wasEditingRef.current) {
            editButtonContainerRef.current?.querySelector('button')?.focus();
        }
        wasEditingRef.current = editing;
    }, [editing]);

    const namesChanged = editing && draftsChanged(nameDrafts, detail?.otherNames);
    const namesBlocked = editing && draftsBlocked(nameDrafts, placeName, nameIndex);

    const handleSave = useCallback(async () => {
        if (!detail || currentUserId === null || scopeRef.current.key !== scopeKey) return;
        // A place with no pin can save its other names (#1185) with the coordinates left empty.
        const parsed = parseCoords(coordsInput);
        const skipCoords = !parsed && coordsInput.trim() === '' && savedCoords === '' && namesChanged;
        if (!parsed && !skipCoords) {
            setCoordsError(t('invalid_coords'));
            return;
        }
        if (namesBlocked) return;
        setCoordsError(null);
        setSaveError(null);
        const token = beginMutation();
        setSaving(true);
        try {
            const client = await getDataClient();
            if (!isCurrentMutation(token)) return;
            // Ordinary Save is a manual coordinate edit. Keep geocoder provenance
            // owned by the explicit re-match action below, so a stale detail page
            // cannot overwrite a newer match.
            if (parsed) await client.places.updateCoordinates(detail.id ?? detail.name, parsed.latitude, parsed.longitude, activeTreeId);
            let auditIds: number[] = [];
            if (namesChanged && detail.id != null) {
                ({ auditIds } = await client.places.saveOtherNames(detail.id, draftsToSave(nameDrafts), activeTreeId));
            }
            if (!isCurrentMutation(token)) return;
            await fetchDetail();
            if (!isCurrentMutation(token)) return;
            setEditing(false);
            if (auditIds.length > 0) {
                const undo = canDelete ? async () => {
                    try {
                        const undoClient = await getDataClient();
                        await undoClient.audit.revert(auditIds, activeTreeId);
                        await fetchDetail();
                    } catch (e) {
                        if (!redirectIfUnauthorized(e)) setSaveError(t('save_failed'));
                    }
                } : undefined;
                showSuccessToast(t('names_saved', { place: placeName }), undo ? { label: tc('undo'), onClick: () => { void undo(); } } : undefined);
            }
        } catch (e) {
            if (!isCurrentMutation(token)) return;
            if (redirectIfUnauthorized(e)) return;
            // A name the server refused says why (another place took it meanwhile).
            setSaveError(e instanceof ValidationError ? e.message : t('save_failed'));
        } finally {
            if (isCurrentMutation(token)) setSaving(false);
        }
    }, [detail, activeTreeId, currentUserId, coordsInput, savedCoords, namesChanged, namesBlocked, nameDrafts, placeName, canDelete, t, tc, fetchDetail, redirectIfUnauthorized, scopeKey, beginMutation, isCurrentMutation]);

    // Re-match: the user picked a different geocoder result for this place (#447).
    //
    // Persist the match and its jurisdiction chain in one transaction. A single-row
    // geocode left previously unparented places at the Explore top level.
    const handleRematch = useCallback(async (candidate: PhotonCandidate) => {
        if (!detail || currentUserId === null || scopeRef.current.key !== scopeKey) return;
        const token = beginMutation();
        setSaveError(null);
        setRematching(true);
        try {
            const client = await getDataClient();
            if (!isCurrentMutation(token)) return;
            await client.places.geocodeUpsertHierarchy(chainFromCandidate(candidate, detail.name), activeTreeId, { reparent: true, leafId: detail.id });
            if (!isCurrentMutation(token)) return;
            // The edit buffer has to follow, or the next Save would write the coordinates
            // the user was looking at BEFORE the re-match straight back over the new ones.
            // Full precision, NOT the 4dp a dragged pin uses: rounding here made the saved
            // row and the buffer disagree, so the "pin moved by hand" note fired on a pin
            // nobody had moved, and the next Save wrote the rounded value back.
            setCoordsInput(`${candidate.result.lat}, ${candidate.result.lng}`);
            setCoordsError(null);
            await fetchDetail();
        } catch (e) {
            if (!isCurrentMutation(token)) return;
            if (redirectIfUnauthorized(e)) return;
            setSaveError(t('rematch_failed'));
        } finally {
            if (isCurrentMutation(token)) setRematching(false);
        }
    }, [detail, activeTreeId, currentUserId, fetchDetail, t, redirectIfUnauthorized, scopeKey, beginMutation, isCurrentMutation]);

    // Open the confirm dialog for a rename/merge (merge = the typed name matches
    // another existing place).
    const handleApplyName = useCallback(() => {
        if (scopeRef.current.key !== scopeKey) return;
        const to = nameInput.trim();
        if (!to || to === placeName) return;
        setSaveError(null);
        const exists = otherPlaces.includes(to);
        setPendingRename({ to, isMerge: exists && !renameChoice.separate, keepOld: renameChoice.keepOld, separate: exists && renameChoice.separate });
    }, [nameInput, placeName, otherPlaces, renameChoice, scopeKey]);

    const doRename = useCallback(async () => {
        if (!pendingRename || currentUserId === null || scopeRef.current.key !== scopeKey) return;
        const token = beginMutation();
        setRenaming(true);
        const target = pendingRename.to;
        try {
            const client = await getDataClient();
            if (!isCurrentMutation(token)) return;
            await client.places.rename(detail?.id ?? placeName, target, activeTreeId, { keepOldName: pendingRename.keepOld, separate: pendingRename.separate });
            if (!isCurrentMutation(token)) return;
            // Close the edit panel and confirm dialog before navigating: the route stays
            // mounted across the URL change, so leftover state would otherwise keep the
            // dialog open showing "rename X → X". rename() cleared the cache → fresh fetch.
            setPendingRename(null);
            setEditing(false);
            // A rename keeps the place's id, so the page stays and reloads; a merge lands
            // on the place it merged into, which this page only knows by name.
            if (!pendingRename.isMerge && detail?.id != null) await fetchDetail();
            else router.replace(placeHref({ name: target }));
        } catch (e) {
            if (!isCurrentMutation(token)) return;
            // Close the dialog on every failure (including a handled auth redirect) so it
            // is never left open and idle.
            setPendingRename(null);
            if (redirectIfUnauthorized(e)) return;
            setSaveError(t('rename_failed'));
        } finally {
            if (isCurrentMutation(token)) setRenaming(false);
        }
    }, [pendingRename, activeTreeId, currentUserId, placeName, detail, router, t, fetchDetail, redirectIfUnauthorized, scopeKey, beginMutation, isCurrentMutation]);

    const handleDelete = useCallback(async () => {
        if (detail?.id == null) return;
        const placeId = detail.id;
        const deletedName = placeName;
        setSaveError(null);
        setDeleting(true);
        try {
            const client = await getDataClient();
            const { auditIds } = await client.places.remove(placeId, activeTreeId);
            setConfirmingDelete(false);
            setEditing(false);
            router.push('/places');
            const undo = auditIds.length > 0 ? async () => {
                try {
                    const undoClient = await getDataClient();
                    await undoClient.audit.revert(auditIds, activeTreeId);
                    router.push(placeHref({ id: placeId, name: '' }));
                } catch (e) {
                    if (!redirectIfUnauthorized(e)) showErrorToast(t('delete_place_undo_failed'));
                }
            } : undefined;
            showSuccessToast(t('delete_place_done', { place: deletedName }), undo ? { label: tc('undo'), onClick: () => { void undo(); } } : undefined);
        } catch (e) {
            setConfirmingDelete(false);
            if (redirectIfUnauthorized(e)) return;
            setSaveError(e instanceof ValidationError ? e.message : t('delete_place_failed'));
        } finally {
            setDeleting(false);
        }
    }, [detail?.id, placeName, activeTreeId, router, t, tc, redirectIfUnauthorized]);

    if (phase === 'ready' && detail && !editing && isMissingPlace(placeName, detail)) {
        return <RecordNotFound record="place" />;
    }

    // Phones get their own page (#1118); the desktop card, rail and inline edit stay above md.
    const role = activePermission === 'view' ? 'viewer' : canDelete ? 'editor' : 'contributor';
    const phonePage = phase === 'loading' ? <MobilePlaceSkeleton />
        : phase === 'pending' ? null
        : detail ? <MobilePlacePage detail={detail} placeName={placeName} treeId={activeTreeId} role={role} onChanged={fetchDetail}
            startRename={phoneRename} onRenameStarted={() => setPhoneRename(null)} />
        : (
            <div className="md:hidden px-4 pt-6">
                {visibleLoadError
                    ? <InlineDataError message={t('load_error')} retryLabel={tc('retry')} onRetry={() => { void fetchDetail(); }} />
                    : <p className="text-text-muted">{t('no_records')}</p>}
            </div>
        );

    return (
        <>
            <PageShell variant="detail" topBar={phonePage} contentClassName="max-md:hidden">
                {/* Anchored header — light DetailHero (tier-1, light tone) */}
                <DetailHero tone="light" className={editing ? 'ring-2 ring-[color:var(--color-text)]' : undefined}>
                    <div className="flex justify-between items-start gap-4 flex-wrap">
                        <div className="flex-1 min-w-0">
                            {editing && (
                                <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium uppercase tracking-wide text-[color:var(--color-text)]">
                                    <Pencil size={12} aria-hidden="true" />
                                    {t('editing_place')}
                                </div>
                            )}
                            <h1 className="title-record text-text">{placeShort}</h1>
                            <OtherNamesSubtitle names={detail?.otherNames} className="mt-0.5 text-md text-text-secondary" />
                            {/* The enclosing places, as links. Not a breadcrumb: the Place-only
                                breadcrumb went in #765; app-wide breadcrumbs are #732's call. */}
                            {detail?.parents && detail.parents.length > 0 && (
                                // A wrapping row, so a deep chain breaks between places on a
                                // phone instead of running off the card: the old inline run
                                // had no break opportunity around a margin-spaced "›" (#928).
                                // Each "›" travels with the place after it.
                                <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm text-text-muted">
                                    <span>{t('part_of')}</span>
                                    {detail.parents.map((p, i) => (
                                        <span key={p.id} className="inline-flex min-w-0 items-baseline gap-x-1.5">
                                            {i > 0 && <span aria-hidden="true">›</span>}
                                            <Link href={placeHref(p)} className="min-w-0 break-words text-link hover:underline">
                                                {p.name.split(',')[0]?.trim() ?? p.name}
                                            </Link>
                                        </span>
                                    ))}
                                </p>
                            )}
                            {detail && (
                                <>
                                    {/* "Geocoded as" lives in Place details only (#1185). */}
                                    <p className="mt-2 text-sm text-text-muted">
                                        <span>{t('people_linked', { count: peopleCount })}</span>
                                        <span> · </span>
                                        <span>{t('records_total', { count: totalCount })}</span>
                                    </p>
                                    <div className="flex gap-2 mt-3 flex-wrap">
                                        {/* The mark comes from the ONE geocode-state set (#266).
                                            It used to be a MapPin in both states, so the same
                                            shape said "has a pin" and "has no pin" and only the
                                            badge tone told them apart — colour alone.
                                            Only the own-pin mark is drawn: this surface knows
                                            whether the place has its OWN coordinates, not
                                            whether an ancestor lends it one, and the hollow
                                            ring specifically means "no pin anywhere". The words
                                            beside it already carry the negative case. */}
                                        {/* Geocoded and the place form are facts, so muted text;
                                            a missing pin is a state to act on, so it keeps its tag (#757). */}
                                        {geocoded ? (
                                            <span className="inline-flex items-center gap-1 text-meta text-text-muted"><PinMark state="own" />{t('geocoded')}</span>
                                        ) : (
                                            <Badge tone="warning">{t('not_geocoded')}</Badge>
                                        )}
                                        {detail.form && <span className="text-meta text-text-muted">{t('form_label', { form: detail.form })}</span>}
                                    </div>
                                </>
                            )}
                        </div>
                        {canEdit && !editing && (
                            <span ref={editButtonContainerRef}>
                                <HeroEditButton onClick={() => handleEdit()} />
                            </span>
                        )}
                        {canEdit && editing && (
                            <div className="flex shrink-0 gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    icon={<X size={13} aria-hidden="true" />}
                                    onClick={handleCancel}
                                    disabled={saving}
                                >
                                    {tc('cancel')}
                                </Button>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    icon={<Check size={13} aria-hidden="true" />}
                                    onClick={handleSave}
                                    disabled={saving || namesBlocked}
                                >
                                    {saving ? t('saving') : t('save')}
                                </Button>
                            </div>
                        )}
                    </div>
                </DetailHero>

                {phase === 'loading' ? (
                    <PlaceDetailSkeleton />
                ) : phase === 'pending' ? null : !detail && visibleLoadError ? (
                    <InlineDataError
                        message={t('load_error')}
                        retryLabel={tc('retry')}
                        onRetry={() => { void fetchDetail(); }}
                    />
                ) : !detail ? (
                    <Card className="text-center py-8">
                        <p className="text-text-muted">{t('no_records')}</p>
                    </Card>
                ) : (
                    <>
                    {visibleLoadError && (
                        <InlineDataError
                            message={t('load_error')}
                            retryLabel={tc('retry')}
                            onRetry={() => { void fetchDetail(); }}
                            className="mb-4"
                        />
                    )}
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_1fr] gap-4 items-start">
                        {/* LEFT — map + people list */}
                        <div>
                            {!mapPoint && descendantMarkers.length > 0 ? (
                                <>
                                    <LocationMap
                                        markers={descendantMarkers}
                                        variant="full"
                                        height={280}
                                        className="mb-4"
                                    />
                                    <div className="mb-4 flex items-start gap-2 text-xs text-text-muted" role="status">
                                        <MapPin size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                                        <span>{t('map_descendants_in', { count: descendantMarkers.length, place: placeName })}</span>
                                    </div>
                                </>
                            ) : mapPoint ? (
                                <>
                                    <LocationMap
                                        markers={[{ lat: mapPoint.lat, lng: mapPoint.lng, label: placeName }]}
                                        variant="full"
                                        height={280}
                                        className="mb-4"
                                        draggable={editing}
                                        onMarkerDragEnd={handlePinDrag}
                                    />
                                    {detail?.inheritedFrom && (detail.latitude == null || detail.longitude == null) && (
                                        <div className="mb-4 flex items-start gap-2 text-xs text-text-muted" role="status">
                                            <PinMark state="inherited" />
                                            <span>{t('map_inherited_from', { place: detail.inheritedFrom.name })}</span>
                                        </div>
                                    )}
                                </>
                            ) : (
                                // No coordinates: a line on how to set a pin by hand, not an
                                // empty 280px map box (FR-5). Live lookup is opt-in (#791).
                                <p className="mb-4 flex items-start gap-2 text-sm text-text-muted">
                                    <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                    <span>{editing ? t('map_none_place_editing') : canEdit ? t('map_none_place_edit') : t('map_none_place')}</span>
                                </p>
                            )}

                            {detail.people.length > 0 && (
                                <>
                                    <SectionHeader title={t('people_connected', { place: placeShort })} />
                                    <Card pad={false} className="overflow-hidden">
                                        {visiblePeople.map((p, i) => {
                                            const fullName = displayFullName(p);
                                            const sex = p.Sex === 'M' ? 'M' : p.Sex === 'F' ? 'F' : null;
                                            return (
                                                <Link
                                                    key={p.Id}
                                                    href={`/people/view?id=${p.Id}`}
                                                    className={`flex items-center gap-3 px-4 py-2.5 min-h-[44px] hover:bg-[color:var(--color-hover-surface)] transition-colors ${i < visiblePeople.length - 1 || hiddenPeople > 0 ? 'border-b border-border-light' : ''}`}
                                                >
                                                    {/* PersonAvatar, not the initials-only `Avatar`: the
                                                        payload carries each person's primary photo and its
                                                        focal crop, and showing initials for someone whose
                                                        face we have reads as "no photo on file". */}
                                                    <PersonAvatar
                                                        mediaId={p.PrimaryMediaId}
                                                        treeId={activeTreeId}
                                                        sex={sex}
                                                        name={fullName}
                                                        initials={initialsFromName(fullName)}
                                                        focalX={p.FocalX}
                                                        focalY={p.FocalY}
                                                        focalRadius={p.FocalRadius}
                                                        size={PERSON_AVATAR_SIZE}
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-semibold text-text truncate">
                                                            {fullName || t('person_fallback', { id: p.Id })}
                                                        </div>
                                                        <div className="text-xs text-text-muted">
                                                            {/* PlaceRole is a raw derived code ('born', 'died',
                                                                'born & died') — it was rendering untranslated,
                                                                so French and Russian users read English here. */}
                                                            {placeRoleLabel(p.PlaceRole, t)}
                                                            {(p.BirthDate || p.DeathDate) && <> · <Lifespan birth={p.BirthDate} death={p.DeathDate} /></>}
                                                            {recordedNames.has(p.Id) && <> · {t.rich('recorded_as', { name: recordedNames.get(p.Id)!, i: (c) => <i className="serif">{c}</i> })}</>}
                                                        </div>
                                                    </div>
                                                    <ChevronRight size={16} className="text-text-muted shrink-0" aria-hidden="true" />
                                                </Link>
                                            );
                                        })}
                                        {hiddenPeople > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setShowAllPeopleFor(scopeKey)}
                                                className="w-full px-4 py-2.5 min-h-[44px] text-sm font-medium text-link text-left cursor-pointer hover:bg-[color:var(--color-hover-surface)] transition-colors focus-ring-inset"
                                            >
                                                {t('show_all_people', { count: detail.people.length })}
                                            </button>
                                        )}
                                    </Card>
                                </>
                            )}

                            {detail.children && detail.children.length > 0 && (
                                <div className="mt-4">
                                    <SectionHeader title={t('places_within', { place: placeShort })} />
                                    <Card pad={false} className="overflow-hidden">
                                        {detail.children.map((c, i, arr) => (
                                            <Link
                                                key={c.id}
                                                href={placeHref(c)}
                                                onMouseEnter={() => prefetchPlace(c.name)}
                                                onFocus={() => prefetchPlace(c.name)}
                                                className={`flex items-center gap-3 px-4 py-2.5 min-h-[44px] hover:bg-[color:var(--color-hover-surface)] transition-colors ${i < arr.length - 1 ? 'border-b border-border-light' : ''}`}
                                            >
                                                <MapPin size={16} className="text-text-muted shrink-0" aria-hidden="true" />
                                                <span className="flex-1 min-w-0 serif text-sm text-text truncate">{c.name.split(',')[0]?.trim() ?? c.name}</span>
                                                <ChevronRight size={16} className="text-text-muted shrink-0" aria-hidden="true" />
                                            </Link>
                                        ))}
                                    </Card>
                                </div>
                            )}
                        </div>

                        {/* RIGHT — details + events rail: cards on the page, headings inside (#764).
                            Swaps to the edit form when editing. */}
                        <DetailRail>
                            {editing ? (
                                <div className="card p-4">
                                    <SectionHeader level="rail" title={t('place_details')} />
                                    <PlaceEditFields
                                        placeName={placeName}
                                        displayName={detail.displayName}
                                        coordsValue={coordsInput}
                                        onCoordsChange={(v) => { setCoordsInput(v); if (coordsError) setCoordsError(null); }}
                                        coordsError={coordsError}
                                        draggableHint={mapPoint != null}
                                        pinAdjusted={pinAdjusted}
                                        nameValue={nameInput}
                                        onNameChange={setNameInput}
                                        otherPlaces={otherPlaces}
                                        onApplyName={handleApplyName}
                                        renaming={renaming}
                                        onRematch={handleRematch}
                                        rematching={rematching}
                                        separate={renameChoice.separate}
                                        renameChoices={
                                            <RenameChoices
                                                from={placeName}
                                                to={nameInput.trim()}
                                                target={otherPlaces.includes(nameInput.trim()) ? nameInput.trim() : null}
                                                records={detail.ownNameRecords ?? 0}
                                                choice={renameChoice}
                                                onChoice={setRenameChoice}
                                                disabled={renaming}
                                            />
                                        }
                                        otherNames={detail.id != null && (
                                            <OtherNamesEditor drafts={nameDrafts} onChange={setNameDrafts} placeName={placeName} index={nameIndex} disabled={saving} />
                                        )}
                                    />
                                    {saveError && (
                                        <p role="alert" className="mt-3 text-xs text-error">{saveError}</p>
                                    )}
                                    {detail.id != null && (
                                        <div className="mt-4 border-t border-border-light pt-4">
                                            <div className="flex flex-wrap gap-2">
                                                <Button variant="outline" size="sm" onClick={() => setMovingRecords(true)} disabled={saving || renaming || deleting}>
                                                    {t('move_records')}
                                                </Button>
                                                {canDelete && detail.uses && placeUnused(detail.uses) && (
                                                    <Button variant="danger-text" size="sm" onClick={() => setConfirmingDelete(true)} disabled={saving || renaming || deleting}>
                                                        {t('delete_place')}
                                                    </Button>
                                                )}
                                            </div>
                                            {canDelete && detail.uses && !placeUnused(detail.uses) && (
                                                <PlaceInUseHint place={placeName} uses={detail.uses} className="mt-2" />
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="card p-4">
                                    <SectionHeader level="rail" title={t('place_details')} />
                                    <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2 text-sm">
                                        {detail.displayName && (
                                            <>
                                                <dt className="text-text-muted">{t('geocoded_label')}</dt>
                                                <dd className="text-text">{detail.displayName}</dd>
                                            </>
                                        )}
                                        {/* "Place name", never "Canonical" or "Display name" —
                                            ADR 0017. This is Places.Name; the row above is
                                            Places.DisplayName. */}
                                        <dt className="text-text-muted">{t('place_name')}</dt>
                                        <dd className="text-text">{placeName}</dd>
                                        <dt className="text-text-muted">{t('coordinates')}</dt>
                                        <dd className="tabular-nums text-text-muted">
                                            {geocoded ? `${detail.latitude!.toFixed(4)}, ${detail.longitude!.toFixed(4)}` : t('not_geocoded_value')}
                                        </dd>
                                    </dl>
                                </div>
                            )}

                            {!editing && detail.id != null && (
                                <OtherNamesCard names={detail.otherNames ?? []} canEdit={canEdit} onAdd={() => handleEdit()} />
                            )}

                            {!editing && eventCounts.length > 0 && (
                                <div className="card p-4">
                                    <SectionHeader level="rail" title={t('events_here')} />
                                    <div className="text-sm">
                                        {eventCounts.map(({ type, label, count }) => (
                                            <div key={type} className="flex justify-between items-center py-1 border-b border-border-light last:border-0">
                                                <span className="text-text">{label}</span>
                                                <span className="tabular-nums text-text-muted">{count}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Notes live in the rail, as on the person and family
                                detail pages — full width made them the loudest thing
                                on the page (review 6 §11.2.8). On mobile the rail
                                stacks under the main column, so they still read last. */}
                            {!editing && detail.id != null && (
                                <OwnerNotesCard
                                        ownerTable="Places"
                                        ownerId={detail.id}
                                        treeId={activeTreeId}
                                        canEdit={canEdit}
                                        canDelete={canDelete}
                                        onNotesChange={(notes) => setNoteCount(notes.length)}
                                        headerRule
                                        header={
                                            <SectionHeader level="rail" className="mb-0" title={<>{tNotes('section_title')} <NoteCount count={noteCount} /></>} />
                                        }
                                    />
                            )}
                        </DetailRail>
                    </div>

                    </>
                )}
            </PageShell>

            {/* Rename / merge confirmation (CRUD §1.2). */}
            <ConfirmDialog
                open={pendingRename != null}
                variant="calm"
                title={pendingRename?.isMerge ? t('confirm_merge_title') : t('confirm_rename_title')}
                body={
                    pendingRename
                        ? (pendingRename.isMerge
                            ? t('confirm_merge_body', { from: placeName, to: pendingRename.to, count: totalCount })
                            : t('confirm_rename_body', { from: placeName, to: pendingRename.to, count: totalCount }))
                        : ''
                }
                warning={pendingRename?.isMerge ? t('merge_undo_hint') : undefined}
                confirmLabel={pendingRename?.isMerge ? t('merge_place') : t('rename_place')}
                busy={renaming}
                onConfirm={doRename}
                onCancel={() => setPendingRename(null)}
            />
            <ConfirmDialog
                open={confirmingDelete}
                variant="calm"
                tone="danger"
                title={t('delete_place_title', { place: placeName })}
                body={t('delete_place_body')}
                confirmLabel={t('delete_place')}
                busy={deleting}
                onConfirm={handleDelete}
                onCancel={() => setConfirmingDelete(false)}
            />
            {movingRecords && detail?.id != null && (
                <MoveRecordsDialog
                    detail={detail}
                    placeId={detail.id}
                    placeName={placeName}
                    treeId={activeTreeId}
                    canUndo={canDelete}
                    onChanged={fetchDetail}
                    onClose={() => setMovingRecords(false)}
                />
            )}
        </>
    );
}
