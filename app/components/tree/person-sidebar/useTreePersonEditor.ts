'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { PersonGalleryMedia, PersonWithRelations } from '@/lib/db/schema';
import { useTree } from '@/app/contexts/TreeContext';
import { getDataClient } from '@/lib/data';
import { errorToastKey } from '@/lib/utils/data-error';
import { NotFoundError } from '@/lib/data/errors';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { usePlaceResolutionFlush } from '@/app/components/usePlaceResolutionFlush';
import type { HierarchyLevel } from '@/lib/geocode/photon';
import type { PinChainRow } from '@/lib/data/types';
import { factPlaceKey, uniquePlaceKeys } from '@/lib/places/place-key';
import { DEATH_DETAILS_CLEARED, statusDropsDeath } from '@/app/components/person-form/vitalEvent';
import {
    emptySidebarForm,
    personToForm,
    buildPersonUpdate,
    computeInitials,
    computeDisplayName,
    isFormDirty,
    applyDeceasedChange,
    type SidebarForm,
} from './state';

interface Params {
    personId: number;
    onClose: () => void;
    onDataChanged?: () => void;
}

/** The place each place field links to (#1186); null for none or a new place. */
interface SidebarPlaceIds {
    birth: number | null;
    death: number | null;
}

const NO_PLACE_IDS: SidebarPlaceIds = { birth: null, death: null };


/** How long the desktop panel waits before sliding in (#14); matched by the canvas panels in globals.css. */
const SLIDE_IN_DELAY_MS = 220;

export function useTreePersonEditor({ personId, onClose, onDataChanged }: Params) {
    const { activeTreeId, activePermission } = useTree();
    const t = useTranslations('treeSidebar');
    const tc = useTranslations('common');
    const { reportError, redirectIfUnauthorized } = useErrorToast();

    const [person, setPerson] = useState<PersonWithRelations | null>(null);
    const [personScope, setPersonScope] = useState<{ treeId: number | null; personId: number } | null>(null);
    const [loadedPersonId, setLoadedPersonId] = useState<number | null>(null);
    const [loadedTreeId, setLoadedTreeId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [primaryPhotoId, setPrimaryPhotoId] = useState<number | null>(null);
    const [mediaScope, setMediaScope] = useState<{ treeId: number | null; personId: number } | null>(null);
    const [primaryPhotoFocal, setPrimaryPhotoFocal] = useState<{ x: number; y: number; r: number | null }>({ x: 50, y: 50, r: null });
    const [mediaError, setMediaError] = useState<string | null>(null);
    const [mediaErrorScope, setMediaErrorScope] = useState<{ treeId: number | null; personId: number } | null>(null);
    const [saving, setSaving] = useState(false);
    const [visible, setVisible] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [form, setForm] = useState<SidebarForm>(emptySidebarForm);
    const [notesExpanded, setNotesExpanded] = useState(false);
    const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Pending place resolutions from the two LocationFields (#461). `undefined` means
    // "nothing changed for this field" and is NOT the same as `null`, an explicit
    // Remove pin — see usePlaceResolutionFlush. They are flushed only after the person
    // update succeeds, which is the ordering the person form uses.
    const [birthPlaceResolution, setBirthPlaceResolution] = useState<HierarchyLevel[] | null | undefined>(undefined);
    const [deathPlaceResolution, setDeathPlaceResolution] = useState<HierarchyLevel[] | null | undefined>(undefined);
    // Already-saved ParentId chains for the loaded person's places, so each field's pin
    // badge paints on open with no Photon call. Read-only: never flushed.
    const [placeChains, setPlaceChains] = useState<Record<string, PinChainRow[]>>({});
    // The place each field links to (#1186), as saved and as picked since. Picking the
    // other of two same-name places changes no text, so it counts as a change itself.
    const [placeIds, setPlaceIds] = useState<SidebarPlaceIds>(NO_PLACE_IDS);
    const [savedPlaceIds, setSavedPlaceIds] = useState<SidebarPlaceIds>(NO_PLACE_IDS);
    const setPlaceId = useCallback((field: keyof SidebarPlaceIds, placeId: number | null) => {
        setPlaceIds((ids) => (ids[field] === placeId ? ids : { ...ids, [field]: placeId }));
    }, []);
    const flushPlaceResolution = usePlaceResolutionFlush(activeTreeId);

    const originalFormRef = useRef(form);
    const [isDirty, setIsDirty] = useState(false);
    // Stamps each load so a slow chain lookup cannot apply to a person the user has
    // since clicked away from — clicking A then B fast would otherwise let A's late
    // response replace B's chains and silently drop B's pin badge.
    const loadSeq = useRef(0);
    const mediaSeq = useRef(0);

    const isReadOnly = activePermission === 'view';

    // A pin-only edit — pick a candidate, enter coordinates, Remove pin — queues a
    // resolution without ever touching the place text, so `isFormDirty` stays false.
    // The sidebar's Save/Discard footer and its unsaved-changes guard are both gated
    // on dirtiness, so without this the pin would be unsaveable and would vanish on
    // close with no warning. (The person form has no dirty gate, which is why the
    // same LocationField behaviour is invisible there.)
    const hasPendingResolution = birthPlaceResolution !== undefined || deathPlaceResolution !== undefined
        || placeIds.birth !== savedPlaceIds.birth || placeIds.death !== savedPlaceIds.death;
    const { guardNavigation } = useUnsavedChangesGuard(isDirty || hasPendingResolution);

    // Detect mobile layout
    useEffect(() => {
        function checkMobile() {
            setIsMobile(window.innerWidth < 768);
        }
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const fetchPerson = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        const seq = ++loadSeq.current;
        try {
            const client = await getDataClient();
            const p = await client.people.get(personId, activeTreeId);
            // The user has clicked to another person while this was in flight. Applying
            // it would clobber their form and blank the chains already painted for them.
            if (loadSeq.current !== seq) return;
            setPerson(p);
            setPersonScope({ treeId: activeTreeId, personId });
            const newForm = personToForm(p);
            setForm(newForm);
            originalFormRef.current = newForm;
            setIsDirty(false);
            setLoadedPersonId(personId);
            setLoadedTreeId(activeTreeId);
            // A new person is loaded: any resolution pending from the previous one is
            // dead. Clicking through the tree must not carry Dover's pin onto Ada.
            setBirthPlaceResolution(undefined);
            setDeathPlaceResolution(undefined);
            const loadedIds = { birth: p.BirthPlaceId ?? null, death: p.DeathPlaceId ?? null };
            setSavedPlaceIds(loadedIds);
            setPlaceIds(loadedIds);
            setPlaceChains({});
            // Seed each field's pin badge from the already-saved chain — one cheap
            // lookup, no Photon call, and it never triggers a write. Best-effort: a
            // failure just means no badge this session. By the place each fact points
            // at, as two places may share a name (#1186).
            const keys = uniquePlaceKeys([factPlaceKey(newForm.BirthPlace, p.BirthPlaceId), factPlaceKey(newForm.DeathPlace, p.DeathPlaceId)]);
            if (keys.length > 0) {
                try {
                    const chains = await client.places.pinChains(keys, activeTreeId);
                    if (loadSeq.current === seq) setPlaceChains(chains);
                } catch { /* badge is optional */ }
            }
        } catch (e) {
            if (redirectIfUnauthorized(e)) return;
            if (e instanceof NotFoundError) {
                // Preserve the sidebar's established missing-person state. A record
                // deleted between tree render and selection is not a retryable read
                // failure and must not be flattened into the generic error banner.
                if (loadSeq.current === seq) {
                    setPerson(null);
                    setPersonScope({ treeId: activeTreeId, personId });
                    setLoadedPersonId(personId);
                    setLoadedTreeId(activeTreeId);
                    setLoadError(null);
                }
                return;
            }
            // The sidebar's owning person remains the primary resource. Keep it
            // distinct from optional place badges and media, and let the shell
            // render this translated retryable state instead of a blank sidebar.
            if (loadSeq.current === seq) setLoadError(tc(errorToastKey(e)));
        } finally {
            if (loadSeq.current === seq) setLoading(false);
        }
    }, [personId, activeTreeId, redirectIfUnauthorized, tc]);

    const fetchMedia = useCallback(async () => {
        const seq = ++mediaSeq.current;
        setMediaError(null);
        setMediaErrorScope(null);
        try {
            const client = await getDataClient();
            const { media } = await client.media.list<PersonGalleryMedia>({ personId, treeId: activeTreeId, includeTagged: true });
            if (mediaSeq.current !== seq) return;
            const primary = media.find((m) => m.IsPersonPrimary);
            setPrimaryPhotoId(primary?.Id || null);
            setMediaScope({ treeId: activeTreeId, personId });
            setPrimaryPhotoFocal(primary?.TagRegionW != null && primary.TagRegionH != null
                ? {
                    x: (primary.TagRegionX ?? 0) + primary.TagRegionW / 2,
                    y: (primary.TagRegionY ?? 0) + primary.TagRegionH / 2,
                    r: Math.max(primary.TagRegionW, primary.TagRegionH),
                }
                : { x: primary?.FocalX ?? 50, y: primary?.FocalY ?? 50, r: primary?.FocalRadius ?? null });
        } catch (e) {
            if (mediaSeq.current !== seq || redirectIfUnauthorized(e)) return;
            // A missing portrait is a valid empty state; a failed media read is
            // separate so it cannot erase the owning person's form.
            setMediaError(tc(errorToastKey(e)));
            setMediaErrorScope({ treeId: activeTreeId, personId });
        }
    }, [personId, activeTreeId, redirectIfUnauthorized, tc]);

    useEffect(() => {
        fetchPerson();
        fetchMedia();
    }, [fetchPerson, fetchMedia]);

    // Only show loading overlay after 300ms to avoid flicker on fast responses
    const currentScope = personScope?.treeId === activeTreeId && personScope.personId === personId;
    const currentMediaScope = mediaScope?.treeId === activeTreeId && mediaScope.personId === personId;
    const isActuallyLoading = loading || loadedPersonId !== personId || loadedTreeId !== activeTreeId;
    useEffect(() => {
        if (!isActuallyLoading) {
            setShowLoadingOverlay(false);
            return;
        }
        const timer = setTimeout(() => setShowLoadingOverlay(true), 300);
        return () => clearTimeout(timer);
    }, [isActuallyLoading]);

    // Slide-in animation. On desktop it waits out a double-click (#14): the first
    // click of a double-click opens the panel and the second re-roots the tree,
    // which closes it again. Holding the slide for SLIDE_IN_DELAY_MS means a
    // double-click closes the panel before it ever shows, instead of flashing it.
    // A phone has no double-click on a card, so its sheet rises at once.
    useEffect(() => {
        const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const frame = requestAnimationFrame(() => {
            if (phone) setVisible(true);
            else timer = setTimeout(() => setVisible(true), SLIDE_IN_DELAY_MS);
        });
        return () => {
            cancelAnimationFrame(frame);
            if (timer) clearTimeout(timer);
            setVisible(false);
        };
    }, []);

    // Track dirty state whenever form changes
    useEffect(() => {
        setIsDirty(isFormDirty(form, originalFormRef.current));
    }, [form]);

    // Set while a Living or Unknown save waits for the user to confirm deleting
    // the death details the status switch cleared from the form (#895).
    const [confirmClearDeath, setConfirmClearDeath] = useState(false);

    // Batch-save all current form fields
    async function handleSave(clearDeath = false) {
        if (isReadOnly) return;
        const original = originalFormRef.current;
        if (!clearDeath && form.IsDeceased !== original.IsDeceased
            && statusDropsDeath(form.IsDeceased, { DeathDate: original.DeathDate, DeathPlace: original.DeathPlace, DeathCause: person?.DeathCause })) {
            setConfirmClearDeath(true);
            return;
        }
        setConfirmClearDeath(false);
        setSaving(true);
        try {
            const client = await getDataClient();
            const update = {
                ...buildPersonUpdate(form),
                BirthPlaceId: form.BirthPlace ? placeIds.birth : null,
                DeathPlaceId: form.DeathPlace ? placeIds.death : null,
            };
            const body = clearDeath ? { ...update, ...DEATH_DETAILS_CLEARED } : update;
            const updated = await client.people.update(personId, body, activeTreeId);
            // update() returns a bare Person (no spouses/parents/events/media/
            // EffectiveFirstName) — merge the saved scalar fields over the loaded
            // relations instead of replacing, or the sidebar loses them (T2).
            setPerson((prev) => (prev ? { ...prev, ...updated } : (updated as unknown as PersonWithRelations)));
            // Place resolutions flush on the SUCCESS path, after the person row is
            // saved — matching the person form's ordering. Best-effort inside, so a
            // failed geocode write cannot undo a save that already landed.
            await Promise.all([
                flushPlaceResolution(form.BirthPlace, birthPlaceResolution, updated.BirthPlaceId),
                clearDeath ? undefined : flushPlaceResolution(form.DeathPlace, deathPlaceResolution, updated.DeathPlaceId),
            ]);
            // Consumed. Leaving them set would rewrite the same pin on every later
            // save of an unrelated field.
            setBirthPlaceResolution(undefined);
            setDeathPlaceResolution(undefined);
            const savedIds = { birth: updated.BirthPlaceId ?? null, death: updated.DeathPlaceId ?? null };
            setSavedPlaceIds(savedIds);
            setPlaceIds(savedIds);
            originalFormRef.current = form;
            setIsDirty(false);
            onDataChanged?.();
        } catch (e) {
            reportError(e);
        } finally {
            setSaving(false);
        }
    }

    // Discard — reset form to original server state (no API call needed since nothing was saved)
    function handleDiscard() {
        const orig = originalFormRef.current;
        setForm(orig);
        setIsDirty(false);
        // Discard means discard: a resolution belongs to the text edit that produced
        // it, so restoring the text without clearing it would leave a pin queued for
        // a place name the user just abandoned.
        setBirthPlaceResolution(undefined);
        setDeathPlaceResolution(undefined);
        setPlaceIds(savedPlaceIds);
    }

    function handleClose() {
        if (!guardNavigation()) return;
        onClose();
    }

    function handleDeceasedChange(value: number | null) {
        setForm((f) => applyDeceasedChange(f, value));
        // Marking someone living clears DeathPlace, so any pin queued for it is
        // orphaned. The flush already skips an empty field; this drops it explicitly
        // so it cannot survive the user typing a new death place later.
        if (value !== 1) setDeathPlaceResolution(undefined);
    }

    const initials = computeInitials(form.FirstName, form.LastName);
    const displayName = computeDisplayName(form.FirstName, form.LastName, t('unknown_person'));

    return {
        person: currentScope ? person : null,
        loading,
        loadError,
        retryLoad: fetchPerson,
        mediaError: mediaErrorScope?.treeId === activeTreeId && mediaErrorScope.personId === personId ? mediaError : null,
        retryMedia: fetchMedia,
        loadedPersonId: loadedTreeId === activeTreeId ? loadedPersonId : null,
        primaryPhotoId: currentMediaScope ? primaryPhotoId : null,
        primaryPhotoFocal: currentMediaScope ? primaryPhotoFocal : { x: 50, y: 50, r: null },
        saving,
        visible,
        isMobile,
        form,
        setForm,
        placeChains,
        placeIds,
        setPlaceId,
        setBirthPlaceResolution,
        setDeathPlaceResolution,
        notesExpanded,
        setNotesExpanded,
        showLoadingOverlay,
        isDirty: isDirty || hasPendingResolution,
        isReadOnly,
        canDelete: activePermission === 'owner' || activePermission === 'edit',
        activeTreeId,
        initials,
        displayName: currentScope ? displayName : t('unknown_person'),
        handleSave,
        confirmClearDeath,
        handleConfirmClearDeath: () => { void handleSave(true); },
        handleCancelClearDeath: () => {
            setConfirmClearDeath(false);
            // Back to the form with the status and death details as they were.
            const orig = originalFormRef.current;
            setForm((f) => ({ ...f, IsDeceased: orig.IsDeceased, DeathDate: orig.DeathDate, DeathPlace: orig.DeathPlace }));
        },
        handleDiscard,
        handleClose,
        guardNavigation,
        handleDeceasedChange,
    };
}
