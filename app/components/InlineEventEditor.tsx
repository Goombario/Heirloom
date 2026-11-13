'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import DateInput from '@/app/components/DateInput';
import { hasUncommittedDate } from '@/app/components/date-input/DateInput';
import { EditorActions, FilterChip, fieldClass, Input, SelectField } from '@/app/components/ui';
import { useLanguage } from '@/app/components/LanguageProvider';
import { EVENT_TYPE_GROUPS } from '@/app/people/view/mobile/model';
import { Sheet } from '@/app/components/ui/Sheet';
import { useTree } from '@/app/contexts/TreeContext';
import { EVENT_TYPES, getEventDisplayType } from '@/lib/db/schema';
import type { GedcomEvent } from '@/lib/db/schema';
import { getDataClient } from '@/lib/data';
import type { PinChainRow } from '@/lib/data/types';
import { errorToastKey } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { useFocusFirstField } from '@/app/hooks/useEditorFocusReturn';
import { factPlaceEntry, factPlaceKey } from '@/lib/places/place-key';
import LocationField from '@/app/components/LocationField';
import type { HierarchyLevel } from '@/lib/geocode/photon';
import { OwnerMediaCard } from '@/app/components/media/OwnerMediaCard';
import EventMediaDraftPanel from '@/app/components/media/EventMediaDraftPanel';
import { useEventMediaDraft } from '@/app/components/media/useEventMediaDraft';
import { FAMILY_EVENT_TYPES, familyEventLabel } from './familyEventTypes';
import { isVitalPersonType, vitalPatchFor } from './person-form/vitalEvent';
import type { UpdatePersonInput } from '@/lib/data/types';

interface InlineEventEditorProps {
    target:
        | { kind: 'person'; personId: number }
        | { kind: 'family'; familyId: number };
    /** Optional default type (e.g. 'BAPM' on person, 'MARR' on family) */
    defaultType?: string;
    /** Present ⇒ edit mode: pre-fill from this event and save via update(). */
    event?: GedcomEvent;
    /** Already-loaded people relevant to existing event media suggestions. */
    relevantPersonIds?: readonly number[];
    /**
     * Option A: allow `BIRT`/`DEAT` in the person type list, routing those saves
     * to the `People` columns instead of the Events table. Each flag should be
     * `true` only when that vital is editable here (e.g. the person lacks it, or
     * this row IS that vital). Absent ⇒ vitals excluded (unchanged behavior).
     */
    allowVital?: { birth: boolean; death: boolean };
    /**
     * Present ⇒ this instance is editing a SYNTHETIC vital row (Option A): the
     * person's Birth/Death, pre-filled from the People columns with a
     * placeholder `event.Id` (no real Events row backs it). Because a person
     * has single birth/death columns, free type-switching is out of scope here
     * — this locks the Type field to the given vital (never a switchable list),
     * and its media section is the person's Birth or Death media (a People
     * `MediaLink` scoped to that fact, ADR 0030), never an Events-row link, which
     * would orphan against the placeholder Id. Real (persisted) events and the
     * family/marriage editor never pass this.
     */
    vitalLock?: 'BIRT' | 'DEAT';
    onCancel: () => void;
    onSaved: () => void;
    /** Refresh the parent after the event persists without closing this editor. */
    onRefresh?: () => void | Promise<void>;
    /** Edit mode only: user asked to delete. The parent owns the confirm + remove. */
    onDelete?: () => void;
    /**
     * The record's notes rail, rendered INSIDE the editor's block, below the fields.
     *
     * It used to be a sibling card stacked beneath this editor, which read as a second
     * competing "notes" section next to the Description field above. The parent still
     * owns the rail (it knows the owner and the counts); this only decides where it
     * sits. Notes save themselves through their own rail, so nothing here reads it and
     * Save/Cancel do not apply to it.
     */
    notesSlot?: ReactNode;
}

type EventFieldSnapshot = {
    type: string;
    date: string;
    place: string;
    description: string;
};

function eventFieldSnapshot(fields: { type: string; date: string; place: string; description: string }): EventFieldSnapshot {
    return {
        type: fields.type,
        date: fields.date || '',
        place: fields.place || '',
        description: fields.description || '',
    };
}

/** Person event type options; vital types (BIRT/DEAT) included only when allowed. */
function personDefaults(allowVital?: { birth: boolean; death: boolean }): { value: string; label: string }[] {
    return Object.entries(EVENT_TYPES)
        .filter(([k]) => {
            if (k === 'BIRT') return allowVital?.birth ?? false;
            if (k === 'DEAT') return allowVital?.death ?? false;
            return true;
        })
        .map(([value, label]) => ({ value, label }));
}

// The likeliest events lead the add-event list; the rest follow alphabetically (FL-1).
const LEADING_TYPES = ['BIRT', 'DEAT', 'BURI'];
const leadRank = (value: string) => {
    const i = LEADING_TYPES.indexOf(value);
    return i === -1 ? LEADING_TYPES.length : i;
};

// Marriage is the family's start anchor (edited on the family form), so it is not
// in the add-event list. Types stay family-scoped — never in EVENT_TYPES.
const FAMILY_DEFAULTS: { value: string; label: string }[] = FAMILY_EVENT_TYPES.map((x) => ({ value: x.value, label: x.value }));

export default function InlineEventEditor({ target, defaultType, event, relevantPersonIds, allowVital, vitalLock, onCancel, onSaved, onRefresh, onDelete, notesSlot }: InlineEventEditorProps) {
    const { activeTreeId, activePermission } = useTree();
    const canDelete = activePermission === 'owner' || activePermission === 'edit';
    const t = useTranslations('eventEdit');
    const tc = useTranslations('common');
    const tTypes = useTranslations('eventTypes');
    const { redirectIfUnauthorized } = useErrorToast();
    const isPerson = target.kind === 'person';
    const [persistedEvent, setPersistedEvent] = useState<GedcomEvent | null>(() => event ?? null);
    const isEdit = persistedEvent != null;
    const isMobile = useIsMobile();
    const tGroups = useTranslations('mobileEvents');
    const { language } = useLanguage();
    const dateFieldId = useId();
    const placeFieldId = useId();
    const headingId = useId();
    // Opening the editor puts focus in its first field (#798, KB-2).
    const panelRef = useRef<HTMLDivElement>(null);
    useFocusFirstField(panelRef);
    // Synthetic-vital mode: Type is locked to vitalLock and media never renders
    // (see the prop doc — no real Events row backs this instance).
    const isSyntheticVital = isPerson && vitalLock != null;
    const optionLabel = (value: string) => {
        if (!isPerson) return familyEventLabel(value, t);
        return EVENT_TYPES[value] ? tTypes(value as Parameters<typeof tTypes>[0]) : getEventDisplayType(value);
    };

    const baseOptions = isSyntheticVital
        ? [{ value: vitalLock, label: optionLabel(vitalLock) }]
        : [...(isPerson ? personDefaults(allowVital) : FAMILY_DEFAULTS)]
            .sort((a, b) => leadRank(a.value) - leadRank(b.value) || optionLabel(a.value).localeCompare(optionLabel(b.value)));
    // In edit mode, an existing event may carry a type not in the defaults list
    // (e.g. an imported one) — keep it selectable so editing never silently
    // rewrites the type. Not applicable in synthetic-vital mode: baseOptions is
    // already exactly [vitalLock], which always matches event.Type there.
    const typeOptions = !isSyntheticVital && event && !baseOptions.some((o) => o.value === event.Type)
        ? [{ value: event.Type, label: event.Type }, ...baseOptions]
        : baseOptions;

    // Lazy initializers seed edit-mode state on first paint (no effect → no flicker).
    // A new event starts with no type: the user picks one before Save enables (FL-1).
    const [type, setType] = useState(() => event?.Type ?? defaultType ?? vitalLock ?? '');
    // Picking a type on the chooser moves on to the date, as the board does.
    const pickedType = useRef(false);
    useEffect(() => {
        if (!pickedType.current || !type) return;
        pickedType.current = false;
        panelRef.current?.querySelector<HTMLInputElement>(`#${CSS.escape(dateFieldId)}`)?.focus();
    }, [type, dateFieldId]);
    const [date, setDate] = useState(() => event?.Date ?? '');
    const [place, setPlace] = useState(() => event?.Place ?? '');
    const [placeResolution, setPlaceResolution] = useState<HierarchyLevel[] | null | undefined>(undefined);
    const [placeChains, setPlaceChains] = useState<Record<string, PinChainRow[]>>({});
    // The place the event links to (#1186): the saved one, then the one picked.
    const [placeId, setPlaceId] = useState<number | null>(() => event?.PlaceId ?? null);
    // For a synthetic death, `event.Description` carries the person's DeathCause,
    // so two pieces of state now hold the cause — `body.Description` must never
    // reach an `Events` row on the vital path (the vital branch below builds its
    // own patch and never sends `body`).
    const [description, setDescription] = useState(() => event?.Description ?? '');
    const [cause, setCause] = useState(() => (vitalLock === 'DEAT' ? event?.Description ?? '' : ''));
    const typeFieldId = useId();
    const descriptionFieldId = useId();
    const causeFieldId = useId();
    const noteHintId = useId();
    // Add-event Birth/Death has no Events row behind it, so its free-text field is
    // a composer for a scoped person note. Synthetic vital rows use the notes rail
    // instead; for synthetic Death, `description` is the Death Cause.
    const isScopedVitalComposer = !isSyntheticVital && isVitalPersonType(target, type);
    // A new Death also owns a DeathCause column even when its Date and Place are
    // blank. Existing non-vital event rows do not use this field.
    const showCauseInput = isPerson && type === 'DEAT' && (isSyntheticVital || !isEdit);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
    const [attachmentBusy, setAttachmentBusy] = useState(false);
    const attachmentBusyRef = useRef(false);
    const saveInFlightRef = useRef(false);
    const attachmentStatusRef = useRef<'idle' | 'running' | 'success' | 'failed'>('idle');
    const attachmentFinishNotifiedRef = useRef(false);
    const savedFieldsRef = useRef<EventFieldSnapshot>(eventFieldSnapshot({
        type: event?.Type ?? defaultType ?? vitalLock ?? '',
        date: event?.Date ?? '',
        place: event?.Place ?? '',
        description: event?.Description ?? '',
    }));
    const currentFieldsRef = useRef<EventFieldSnapshot>(savedFieldsRef.current);
    currentFieldsRef.current = eventFieldSnapshot({ type, date, place, description });

    function hasDirtyFields() {
        const current = currentFieldsRef.current;
        const saved = savedFieldsRef.current;
        return current.type !== saved.type
            || current.date !== saved.date
            || current.place !== saved.place
            || current.description !== saved.description;
    }

    function maybeFinishAfterAttachments() {
        if (attachmentStatusRef.current !== 'success' || attachmentFinishNotifiedRef.current) return;
        if (saveInFlightRef.current || hasDirtyFields()) return;
        attachmentFinishNotifiedRef.current = true;
        onSaved();
    }

    const draft = useEventMediaDraft({ treeId: activeTreeId, galleryPersonId: target.kind === 'person' ? target.personId : undefined });
    // Birth and death live on the People row, which can't hold media yet (#905),
    // so a draft staged before switching to them would be dropped on Save.
    const vitalMediaStaged = isScopedVitalComposer && draft.items.length > 0;

    async function processAttachments(eventId: number) {
        if (attachmentBusyRef.current) return;
        attachmentBusyRef.current = true;
        attachmentStatusRef.current = 'running';
        attachmentFinishNotifiedRef.current = false;
        setAttachmentBusy(true);
        setAttachmentNotice(null);
        try {
            const outcome = await draft.process(eventId);
            if (outcome.failed.length === 0) {
                attachmentStatusRef.current = 'success';
                maybeFinishAfterAttachments();
                return;
            }
            attachmentStatusRef.current = 'failed';
            setAttachmentNotice(t('media_saved_attention'));
            try { await onRefresh?.(); } catch { /* parent refresh is best-effort */ }
        } catch {
            attachmentStatusRef.current = 'failed';
            setAttachmentNotice(t('media_saved_attention'));
            try { await onRefresh?.(); } catch { /* parent refresh is best-effort */ }
        } finally {
            attachmentBusyRef.current = false;
            setAttachmentBusy(false);
        }
    }

    // Escape asks before discarding edits (#798, KB-3), including a date typed
    // but not yet blurred, which hasn't reached `date` (#861).
    const dirty = type !== (event?.Type ?? defaultType ?? vitalLock ?? '') || date !== (event?.Date ?? '')
        || place !== (event?.Place ?? '') || placeId !== (event?.PlaceId ?? null) || description !== (event?.Description ?? '')
        || cause !== (vitalLock === 'DEAT' ? event?.Description ?? '' : '');
    const dirtyRef = useRef(dirty);
    useEffect(() => { dirtyRef.current = dirty; });

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key !== 'Escape') return;
            // Escape belongs to the innermost thing that is open. The notes rail now
            // renders INSIDE this editor (`notesSlot`), bringing its ⋯ popover and its
            // delete confirm with it — and both listen on `document` too, where
            // stopPropagation cannot help: it does not stop sibling listeners on the
            // same node, and this one is registered first anyway (the editor mounts
            // before either opens). Cancelling here would discard the user's unsaved
            // Date/Place edits behind a dialog they were only trying to dismiss.
            // Both move focus into themselves when they open, so the keystroke's own
            // target says whose Escape this is.
            const from = e.target as Element | null;
            if (from?.closest?.('[role="dialog"], [role="menu"]')) return;
            if ((dirtyRef.current || hasUncommittedDate(panelRef.current)) && !window.confirm(tc('unsaved_changes_confirm'))) return;
            onCancel();
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onCancel, tc]);

    // Read-only lookup for this event's already-saved pin chain
    // (edit-mode pin display) — only runs when editing an existing event
    // (event.Place has a value); a brand-new event has nothing saved yet.
    useEffect(() => {
        const key = factPlaceKey(event?.Place, event?.PlaceId);
        if (key == null) return;
        let cancelled = false;
        (async () => {
            try {
                const client = await getDataClient();
                const chains = await client.places.pinChains([key], activeTreeId);
                if (!cancelled) setPlaceChains(chains);
            } catch {
                // Best-effort — a failed lookup just means no badge shows this session.
            }
        })();
        return () => { cancelled = true; };
    }, [event?.Place, event?.PlaceId, activeTreeId]);

    async function handleSave() {
        if (!type) return;
        saveInFlightRef.current = true;
        setSaving(true);
        setError(null);
        let eventSaveSucceeded = false;
        try {
            const body = {
                Type: type,
                Date: date || null,
                Place: place || null,
                PlaceId: place ? placeId : null,
                Description: description || null,
                PersonId: target.kind === 'person' ? target.personId : null,
                FamilyId: target.kind === 'family' ? target.familyId : null,
            };
            const client = await getDataClient();
            const savesVital = isVitalPersonType(target, type);
            let savedEvent = persistedEvent;
            let createdNow = false;
            // The place the saved fact points at, for its pin below.
            let savedPlaceId: number | null | undefined;
            if (savesVital) {
                // Option A: birth/death live on the People row, not the Events table.
                // vitalPatchFor emits IsDeceased as the numeric 1 the update service
                // accepts (it maps any non-1/0 value to null).
                const pick = place ? placeId : null;
                const saved = await client.people.update(
                    target.personId,
                    {
                        ...vitalPatchFor(type, date, place, showCauseInput ? cause : undefined),
                        ...(type === 'DEAT' ? { DeathPlaceId: pick } : { BirthPlaceId: pick }),
                    } as UpdatePersonInput,
                    activeTreeId,
                );
                savedPlaceId = type === 'DEAT' ? saved?.DeathPlaceId : saved?.BirthPlaceId;
                const noteText = description.trim();
                if (isScopedVitalComposer && noteText) {
                    await client.notes.create(
                        'People',
                        target.personId,
                        noteText,
                        activeTreeId,
                        type === 'DEAT' ? 'Death' : 'Birth',
                    );
                }
            } else if (savedEvent) {
                const updated = await client.events.update(savedEvent.Id, body, activeTreeId);
                savedEvent = updated;
                savedPlaceId = updated?.PlaceId;
                setPersistedEvent(updated);
                savedFieldsRef.current = eventFieldSnapshot({ type, date, place, description });
                eventSaveSucceeded = true;
            } else {
                const created = await client.events.create(body, activeTreeId);
                savedEvent = created;
                savedPlaceId = created?.PlaceId;
                createdNow = true;
                setPersistedEvent(created);
                savedFieldsRef.current = eventFieldSnapshot({ type, date, place, description });
                eventSaveSucceeded = true;
            }
            if (placeResolution !== undefined && place.trim()) {
                try {
                    // To the place the saved fact points at: two places may share a name (#1186).
                    if (placeResolution === null) {
                        await client.places.geocodeUpsert({ name: place, placeId: savedPlaceId, latitude: null, longitude: null, pinSuppressed: true }, activeTreeId);
                    } else if (placeResolution.length > 0) {
                        if (savedPlaceId != null) await client.places.geocodeUpsertHierarchy(placeResolution, activeTreeId, { leafId: savedPlaceId });
                        else await client.places.geocodeUpsertHierarchy(placeResolution, activeTreeId);
                    }
                } catch {
                    // Non-fatal — coordinates are a cache, not user content.
                }
            }
            if (createdNow && savedEvent && draft.items.length > 0) {
                // Creation is already durable. Re-enable field editing while the
                // independent best-effort attachment phase runs.
                setSaving(false);
                await processAttachments(savedEvent.Id);
                return;
            }
            if (!savesVital && savedEvent && (attachmentBusyRef.current || draft.items.length > 0 || draft.failures.length > 0)) {
                try { await onRefresh?.(); } catch { /* parent refresh is best-effort */ }
                setSaving(false);
                return;
            }
            // A successful attachment phase may already be waiting for these
            // dirty fields to save. Mark completion before the direct callback
            // so the finally-path coordinator cannot notify the parent twice.
            attachmentFinishNotifiedRef.current = true;
            onSaved();
        } catch (err) {
            if (redirectIfUnauthorized(err)) return;
            setError(tc(errorToastKey(err)));
            setSaving(false);
        } finally {
            saveInFlightRef.current = false;
            setSaving(false);
            if (eventSaveSucceeded) maybeFinishAfterAttachments();
        }
    }

    const label = isEdit ? t('editing_event') : t('new_event');
    const fields = (
        <>

            {/* Field stack — kept as flat siblings with consistent spacing so a future
                "Photos / documents" section can slot in beneath Note without a rewrite
                (event media will attach via MediaLink OwnerTable='Events'). */}
            <div className="grid gap-2.5 mb-2.5">
                <div>
                    <label htmlFor={typeFieldId} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>{t('field_type')}</label>
                    <SelectField
                        id={typeFieldId}
                        size="sm"
                        value={type}
                        onChange={setType}
                        disabled={isSyntheticVital}
                        options={[
                            ...(event || isSyntheticVital ? [] : [{ value: '', label: t('choose_event') }]),
                            ...typeOptions.map((opt) => ({ value: opt.value, label: optionLabel(opt.value) })),
                        ]}
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>{t('field_date')}</label>
                    <DateInput value={date} onChange={setDate} className={fieldClass('sm')} stacked={isMobile} />
                </div>
            </div>

            <div className="mb-2.5">
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>{t('field_place')}</label>
                <LocationField
                    value={place}
                    onChange={setPlace}
                    onResolve={setPlaceResolution}
                    onRemove={() => setPlaceResolution(null)}
                    initialChain={factPlaceEntry(placeChains, place, placeId) ?? null}
                    placeId={placeId}
                    onPlaceIdChange={setPlaceId}
                    treeId={activeTreeId}
                    className={fieldClass('sm')}
                    placeholder={t('place_placeholder')}
                />
            </div>

            {showCauseInput && (
                <div className="mb-2.5">
                    <label htmlFor={causeFieldId} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>{t('field_cause')}</label>
                    <input
                        id={causeFieldId}
                        type="text"
                        className={fieldClass('sm')}
                        value={cause}
                        onChange={(e) => setCause(e.target.value)}
                    />
                </div>
            )}

            {/* This is Events."Description" — the event's OWN value, which for an
                attribute like OCCU is where "Blacksmith" belongs. It was labelled
                "Note", which put a second thing calling itself a note directly above
                the record's actual notes rail; the label now says what the field is.
                Hidden on a synthetic vital, which has no Events row to hold one (a
                death's cause has its own input above, and the vital's notes are in
                `notesSlot`). See #561 for how this column exports. */}
            {!isSyntheticVital && (
                <div className="mb-2.5">
                    <label htmlFor={descriptionFieldId} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>{t(isScopedVitalComposer ? 'field_note' : 'field_description')} <span className="muted font-normal">· {t('optional')}</span></label>
                    <textarea
                        id={descriptionFieldId}
                        rows={2}
                        className={`${fieldClass('sm')} resize-y`}
                        aria-describedby={isScopedVitalComposer ? noteHintId : undefined}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t(isScopedVitalComposer ? 'note_placeholder' : 'description_placeholder')}
                    />
                    {isScopedVitalComposer && (
                        <p id={noteHintId} className="muted text-meta mt-1 mb-0">
                            {type === 'DEAT' ? t('note_scoped_death_hint') : t('note_scoped_birth_hint')}
                        </p>
                    )}
                </div>
            )}
            {/* Synthetic vitals have no Events row: their media is the person's,
                scoped to the fact (ADR 0030). Real events stage media before
                create, retain failures after create, then return to the canonical
                owner gallery once the draft is empty. Add-event Birth/Death has no
                Events row either, so it offers no media box (#927); media staged
                under another type stays visible so it can be removed before Save. */}
            {isSyntheticVital && target.kind === 'person' ? (
                <div className="mb-2.5">
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>{t('field_media')}</label>
                    <OwnerMediaCard
                        ownerTable="People"
                        ownerId={target.personId}
                        ownerFact={vitalLock === 'DEAT' ? 'Death' : 'Birth'}
                        treeId={activeTreeId}
                        canEdit
                        canDelete={canDelete}
                        relevantPersonIds={relevantPersonIds ?? [target.personId]}
                        onChanged={onRefresh}
                    />
                </div>
            ) : isScopedVitalComposer && !vitalMediaStaged ? null : persistedEvent && draft.items.length === 0 && draft.failures.length === 0 ? (
                <div className="mb-2.5">
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>{t('field_media')}</label>
                    <OwnerMediaCard
                        ownerTable="Events"
                        ownerId={persistedEvent.Id}
                        treeId={activeTreeId}
                        canEdit
                        canDelete={canDelete}
                        relevantPersonIds={relevantPersonIds ?? (target.kind === 'person' ? [target.personId] : undefined)}
                        galleryPersonId={target.kind === 'person' ? target.personId : undefined}
                    />
                </div>
            ) : (
                <div className="mb-2.5">
                    {vitalMediaStaged && <p className="mb-1.5 text-meta text-warning-text" role="status">{t('vital_media_unsupported')}</p>}
                    <EventMediaDraftPanel
                        treeId={activeTreeId}
                        draft={draft}
                        ownerId={persistedEvent?.Id}
                        relevantPersonIds={relevantPersonIds ?? (target.kind === 'person' ? [target.personId] : undefined)}
                        galleryPersonId={target.kind === 'person' ? target.personId : undefined}
                        onRetry={attachmentBusy || !persistedEvent ? undefined : () => { void processAttachments(persistedEvent.Id); }}
                    />
                </div>
            )}

            {attachmentNotice && <div className="mb-2 text-sm text-warning-text" role="status">{attachmentNotice}</div>}

            {/* The record's notes, inside the block rather than stacked under it. Last,
                after the fields Save actually writes, so the editor still reads
                top-to-bottom as "the things this button saves" and then "the notes,
                which save themselves". */}
            {notesSlot && <div className={isMobile ? 'mb-2.5 sheet-flat' : 'mb-2.5'}>{notesSlot}</div>}

            {error && (
                <div className="mb-2 text-meta" style={{ color: 'var(--error)' }}>{error}</div>
            )}

            <EditorActions
                size="sm"
                onSave={handleSave}
                onCancel={onCancel}
                saving={saving}
                saveLabel={t('save_event')}
                saveDisabled={!type || vitalMediaStaged}
                onDelete={isEdit ? onDelete : undefined}
                deleteLabel={t('delete_event')}
            />
        </>
    );

    // ── The desktop panel (locked person board): a heading, a type chooser for a new
    // event, then date and place side by side, a one-line description, the event's
    // notes, its media, and Delete · Cancel · the copper Save on the action row.
    const typeName = (value: string) => {
        const name = optionLabel(value);
        // "Add occupation": a lower-case type reads as English prose; other
        // languages keep the label as written.
        return language.startsWith('en') ? name.toLocaleLowerCase('en') : name;
    };
    // A new event with no preset type starts on the chooser, and can go back to it.
    const choosing = !isEdit && !isSyntheticVital && !type;
    const canChangeType = !isEdit && !isSyntheticVital && !defaultType && !!type;
    const heading = choosing ? t('add_life_event')
        : isEdit ? t('edit_named', { type: typeName(type) })
        : t('add_named', { type: typeName(type) });
    const chooserGroups: { key: string; label: string; types: string[] }[] = isPerson
        ? [
            ...EVENT_TYPE_GROUPS.map((g) => ({
                key: g.key,
                label: tGroups(`group_${g.key}`),
                types: g.types.filter((v) => (v === 'BIRT' ? allowVital?.birth ?? false : v === 'DEAT' ? allowVital?.death ?? false : true)),
            })),
            { key: 'other', label: t('group_other'), types: ['EVEN'] },
        ].filter((g) => g.types.length > 0)
        : [{ key: 'family', label: '', types: typeOptions.map((o) => o.value) }];

    const desktopChooser = (
        <>
            {chooserGroups.map((g) => (
                <div key={g.key} className="grid gap-1.5">
                    {g.label && <h4 className="eyebrow m-0 text-text-muted">{g.label}</h4>}
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label={g.label || heading}>
                        {g.types.map((v) => (
                            <FilterChip key={v} label={optionLabel(v)} onClick={() => { pickedType.current = true; setType(v); }} />
                        ))}
                    </div>
                </div>
            ))}
            {isPerson && <p className="m-0 text-meta text-text-muted">{t('marriages_from_family')}</p>}
            <div className="flex justify-end">
                <button type="button" onClick={onCancel} className="inline-flex items-center h-8 px-3 rounded-btn text-sm text-text-secondary bg-transparent border-0 cursor-pointer hover:bg-hover-surface focus-ring">{tc('cancel')}</button>
            </div>
        </>
    );

    const fieldLabel = 'block text-meta font-medium mb-1 text-[color:var(--text-2)]';
    const desktopFields = (
        <>
            {/* Type: only when editing an event that can change type (a new one picked it above). */}
            {isEdit && !isSyntheticVital && (
                <div className="max-w-[340px]">
                    <label htmlFor={typeFieldId} className={fieldLabel}>{t('field_type')}</label>
                    <SelectField id={typeFieldId} size="sm" value={type} onChange={setType}
                        options={typeOptions.map((opt) => ({ value: opt.value, label: optionLabel(opt.value) }))} />
                </div>
            )}
            <div className="grid gap-x-4 gap-y-3 grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
                <div className="min-w-0">
                    <label htmlFor={dateFieldId} className={fieldLabel}>{t('field_date')}</label>
                    <DateInput id={dateFieldId} value={date} onChange={setDate} className={fieldClass('sm')} />
                    <p className="m-0 mt-1 text-xs text-text-muted">{t('date_hint')}</p>
                </div>
                <div className="min-w-0">
                    <label htmlFor={placeFieldId} className={fieldLabel}>{t('field_place')}</label>
                    <LocationField
                        id={placeFieldId}
                        value={place}
                        onChange={setPlace}
                        onResolve={setPlaceResolution}
                        onRemove={() => setPlaceResolution(null)}
                        initialChain={factPlaceEntry(placeChains, place, placeId) ?? null}
                        placeId={placeId}
                        onPlaceIdChange={setPlaceId}
                        treeId={activeTreeId}
                        className={fieldClass('sm')}
                        placeholder={t('place_search_placeholder')}
                    />
                </div>
            </div>
            {showCauseInput && (
                <div>
                    <label htmlFor={causeFieldId} className={fieldLabel}>{t('field_cause_of_death')}</label>
                    <Input id={causeFieldId} size="sm" value={cause} onChange={(e) => setCause(e.target.value)} placeholder={t('cause_placeholder')} />
                </div>
            )}
            {!isSyntheticVital && (isScopedVitalComposer ? (
                <div>
                    <label htmlFor={descriptionFieldId} className={fieldLabel}>{t('field_note')}</label>
                    <textarea id={descriptionFieldId} rows={2} className={`${fieldClass('sm')} resize-y`} aria-describedby={noteHintId}
                        value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('note_placeholder')} />
                    <p id={noteHintId} className="m-0 mt-1 text-xs text-text-muted">
                        {type === 'DEAT' ? t('note_scoped_death_hint') : t('note_scoped_birth_hint')}
                    </p>
                </div>
            ) : (
                <div>
                    <label htmlFor={descriptionFieldId} className={fieldLabel}>{t('field_description')}</label>
                    <Input id={descriptionFieldId} size="sm" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('description_line_placeholder')} />
                </div>
            ))}
            {notesSlot && <div>{notesSlot}</div>}
            {isSyntheticVital && target.kind === 'person' ? (
                <div className="event-panel__media">
                    <span className={fieldLabel}>{t('field_media_short')}</span>
                    <OwnerMediaCard look="strip" ownerTable="People" ownerId={target.personId} ownerFact={vitalLock === 'DEAT' ? 'Death' : 'Birth'}
                        treeId={activeTreeId} canEdit canDelete={canDelete} relevantPersonIds={relevantPersonIds ?? [target.personId]} onChanged={onRefresh} />
                </div>
            ) : isScopedVitalComposer && !vitalMediaStaged ? null : persistedEvent && draft.items.length === 0 && draft.failures.length === 0 ? (
                <div className="event-panel__media">
                    <span className={fieldLabel}>{t('field_media_short')}</span>
                    <OwnerMediaCard look="strip" ownerTable="Events" ownerId={persistedEvent.Id} treeId={activeTreeId} canEdit canDelete={canDelete}
                        relevantPersonIds={relevantPersonIds ?? (target.kind === 'person' ? [target.personId] : undefined)}
                        galleryPersonId={target.kind === 'person' ? target.personId : undefined} />
                </div>
            ) : (
                <div className="event-panel__media">
                    <span className={fieldLabel}>{t('field_media_short')}</span>
                    {vitalMediaStaged && <p className="mb-1.5 text-meta text-warning-text" role="status">{t('vital_media_unsupported')}</p>}
                    <EventMediaDraftPanel
                        look="plain"
                        treeId={activeTreeId}
                        draft={draft}
                        ownerId={persistedEvent?.Id}
                        relevantPersonIds={relevantPersonIds ?? (target.kind === 'person' ? [target.personId] : undefined)}
                        galleryPersonId={target.kind === 'person' ? target.personId : undefined}
                        onRetry={attachmentBusy || !persistedEvent ? undefined : () => { void processAttachments(persistedEvent.Id); }}
                    />
                </div>
            )}
            {attachmentNotice && <div className="text-sm text-warning-text" role="status">{attachmentNotice}</div>}
            {error && <div className="text-meta" style={{ color: 'var(--error)' }}>{error}</div>}
            <EditorActions
                size="sm"
                onSave={handleSave}
                onCancel={onCancel}
                saving={saving}
                saveLabel={isEdit ? undefined : t('add_event')}
                saveDisabled={!type || vitalMediaStaged}
                onDelete={isEdit ? onDelete : undefined}
                deleteLabel={t('delete_event')}
            />
        </>
    );

    // Below md the editor opens in a bottom sheet with every field full width,
    // rather than squeezed beside the timeline's year gutter (#797, M-2).
    if (isMobile) {
        return (
            <Sheet open onClose={onCancel} title={label}>
                <div role="group" aria-label={label}>{fields}</div>
            </Sheet>
        );
    }

    // One panel style for add and edit (#760): the collections pattern's inline panel,
    // headed and laid out as on the locked person board.
    return (
        <div ref={panelRef} className="inline-panel event-panel grid gap-3.5" role="group" aria-labelledby={headingId}>
            <div className="flex items-baseline justify-between gap-2.5">
                <h3 id={headingId} className="m-0 text-base font-semibold text-text">{heading}</h3>
                {choosing && <span className="text-meta text-text-muted">{t('choose_type')}</span>}
                {canChangeType && (
                    <button type="button" onClick={() => setType('')} className="p-0 bg-transparent border-0 text-sm text-link cursor-pointer hover:underline focus-ring rounded-sm">{t('change_type')}</button>
                )}
            </div>
            {choosing ? desktopChooser : desktopFields}
        </div>
    );
}
