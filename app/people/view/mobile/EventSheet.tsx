'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { GedcomEvent, PersonWithRelations } from '@/lib/db/schema';
import { getDataClient } from '@/lib/data';
import type { UpdatePersonInput } from '@/lib/data/types';
import type { HierarchyLevel } from '@/lib/geocode/photon';
import { formatDateForDisplay } from '@/lib/date-utils';
import DateInput from '@/app/components/DateInput';
import LocationField from '@/app/components/LocationField';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { usePlaceResolutionFlush } from '@/app/components/usePlaceResolutionFlush';
import { OwnerMediaCard } from '@/app/components/media/OwnerMediaCard';
import EventMediaDraftPanel from '@/app/components/media/EventMediaDraftPanel';
import { useEventMediaDraft } from '@/app/components/media/useEventMediaDraft';
import { displayFullName } from '@/lib/utils/names';
import { vitalPatchFor } from '@/app/components/person-form/vitalEvent';
import type { CitationFactDescriptor } from '@/app/components/citations/types';
import type { CiteSheetsSlot } from '@/app/components/citations/CiteSheets';
import { MobileRow, citeClass, cx, fieldClass, showErrorToast } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { Camera, Pencil, Plus, Search, Trash2 } from '@/lib/icons';
import type { SourceNumbers } from '@/app/components/citations/factDescriptors';
import {
    EVENT_TYPE_GROUPS, alreadyRecorded, commonEventTypes, nameBarParts, recordedCount, resolveEventType,
    type MobileFact,
} from './model';
import type { RunChange } from './useChange';

/*
 * One sheet to add, edit and delete any event on the phone (#1048, tracking #1054).
 * Birth and death are the person's own columns; every other event is an Events row.
 * The sheet hides that: both save through `saveFact`, and Delete clears the columns
 * or removes the row. Add event opens on a chooser of common types, with every type
 * grouped (and your own) under More types.
 */

/** Which field a vitals panel row asked for. */
export type EventFocus = 'date' | 'place' | 'detail' | 'sources';

/** What opened the sheet. */
export type EventFlow =
    | { kind: 'choose' }
    | { kind: 'add'; type: string }
    | { kind: 'edit'; fact: MobileFact; focus?: EventFocus };

type Step = { step: 'choose' } | { step: 'more' } | { step: 'form'; type: string; fact: MobileFact | null; from: 'choose' | 'more' | null };

/** `placeId`: the place the fact links to (#1186), saved or picked. */
interface Draft { date: string; place: string; placeId: number | null; detail: string }

function initialStep(flow: EventFlow): Step {
    if (flow.kind === 'choose') return { step: 'choose' };
    if (flow.kind === 'add') return { step: 'form', type: flow.type, fact: null, from: null };
    return { step: 'form', type: flow.fact.type, fact: flow.fact, from: null };
}

function draftOf(fact: MobileFact | null): Draft {
    return { date: fact?.date ?? '', place: fact?.place ?? '', placeId: fact?.placeId ?? null, detail: fact?.detail ?? '' };
}

/** The type's shown name; a custom type is its own name. */
function useEventTypeLabel() {
    const tTypes = useTranslations('eventTypes');
    return (type: string) => (tTypes.has(type as Parameters<typeof tTypes>[0]) ? tTypes(type as Parameters<typeof tTypes>[0]) : type);
}

export interface EventSheetProps {
    flow: EventFlow | null;
    onClose: () => void;
    person: PersonWithRelations;
    treeId: number | null;
    language: string;
    /** Editors delete; contributors don't (#1054 Roles). */
    canDelete: boolean;
    facts: CitationFactDescriptor[];
    sourceNumbers: SourceNumbers;
    run: RunChange;
    /** The cite sheets, opened on top of this one for a saved fact (#1049). */
    citeSheets: CiteSheetsSlot;
    /** The changed row's key, so it flashes once. */
    onSaved: (key: string) => void;
}

export function EventSheet(props: EventSheetProps) {
    // A fresh flow starts a fresh sheet, so nothing typed into the last one survives.
    // The last one stays mounted while it closes, so the sheet can animate away.
    const [prev, setPrev] = useState<EventFlow | null>(null);
    const [shown, setShown] = useState<{ flow: EventFlow; n: number } | null>(null);
    if (props.flow !== prev) {
        setPrev(props.flow);
        const next = props.flow;
        if (next) setShown((s) => ({ flow: next, n: (s?.n ?? 0) + 1 }));
    }
    if (!shown) return null;
    return <EventSheetBody key={shown.n} {...props} open={props.flow != null} flow={shown.flow} />;
}

function EventSheetBody({ open, flow, onClose, person, treeId, language, canDelete, facts, sourceNumbers, run, citeSheets, onSaved }: Omit<EventSheetProps, 'flow'> & { open: boolean; flow: EventFlow }) {
    const t = useTranslations('mobileEvents');
    const label = useEventTypeLabel();
    const words = useDateQualifierWords();
    const flushPlace = usePlaceResolutionFlush(treeId);
    const draftMedia = useEventMediaDraft({ treeId, galleryPersonId: person.Id });
    const ids = useId();
    const [step, setStep] = useState<Step>(() => initialStep(flow));
    const fact = step.step === 'form' ? step.fact : null;
    const [draft, setDraft] = useState<Draft>(() => draftOf(fact));
    const [saved, setSaved] = useState<Draft>(() => draftOf(fact));
    const [resolution, setResolution] = useState<HierarchyLevel[] | null | undefined>(undefined);
    const [showDetail, setShowDetail] = useState(() => Boolean(fact?.detail));
    const [showMedia, setShowMedia] = useState(false);
    const [saving, setSaving] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [citing, setCiting] = useState(false);
    const [query, setQuery] = useState('');
    const sourcesRef = useRef<HTMLDivElement>(null);
    const formRef = useRef<HTMLDivElement>(null);
    // The date and place controls own their inputs, so focus goes by id inside the form.
    const focusField = (id: string) => formRef.current?.querySelector<HTMLElement>(`[id="${id}"]`)?.focus();
    const name = nameBarParts(person).given || t('this_person');

    const type = step.step === 'form' ? step.type : '';
    // A legacy Events row of type BIRT stays a row; only the person's columns are vital.
    const vital = step.step === 'form' && (step.fact ? step.fact.vital : type === 'BIRT' || type === 'DEAT');
    // "Edit birth": English lowercases a known type mid-sentence; the other catalogs
    // put the type after a colon, where it keeps its capital. Your own type keeps yours.
    const inline = (x: string) => (isKnownType(x) && language.startsWith('en') ? label(x).toLocaleLowerCase('en') : label(x));
    // Setting or removing the place's map pin is a change too, even with the text untouched.
    const dirty = step.step === 'form'
        && (draft.date !== saved.date || draft.place !== saved.place || draft.placeId !== saved.placeId || draft.detail !== saved.detail
            || resolution !== undefined || draftMedia.items.length > 0);

    // A vitals row that asked for a field opens with it focused (and the keyboard up),
    // as does a new event's Date. Sources scroll into view instead.
    useEffect(() => {
        if (step.step !== 'form') return;
        const focus = flow.kind === 'edit' && step.fact === flow.fact ? flow.focus : step.fact ? undefined : 'date';
        if (!focus) return;
        const timer = window.setTimeout(() => {
            if (focus === 'sources') { sourcesRef.current?.scrollIntoView({ block: 'start' }); return; }
            if (focus === 'detail') setShowDetail(true);
            const id = focus === 'date' ? `${ids}-date` : focus === 'place' ? `${ids}-place` : `${ids}-detail`;
            requestAnimationFrame(() => focusField(id));
        }, 320);
        return () => window.clearTimeout(timer);
    }, [step, flow, ids]);

    const pick = (next: string, from: 'choose' | 'more') => {
        setStep({ step: 'form', type: next, fact: null, from });
        setDraft(draftOf(null));
        setSaved(draftOf(null));
        setShowDetail(false);
    };

    const back = () => {
        if (step.step === 'more') setStep({ step: 'choose' });
        else if (step.step === 'form' && step.from) {
            setStep(step.from === 'more' ? { step: 'more' } : { step: 'choose' });
            setDraft(draftOf(null)); setSaved(draftOf(null)); setResolution(undefined);
        }
    };

    const when = (d: string | null | undefined, p: string | null | undefined) =>
        [d ? formatDateForDisplay(d, language, words) : null, p?.split(',')[0]?.trim() || null].filter(Boolean).join(' · ');

    async function save() {
        if (step.step !== 'form' || saving) return;
        setSaving(true);
        const isNew = !step.fact;
        const date = draft.date.trim(), place = draft.place.trim(), detail = draft.detail.trim();
        const placeId = place ? draft.placeId : null;
        let key = step.fact?.key ?? '';
        let mediaFailed = false;
        const ok = await run(async () => {
            const client = await getDataClient();
            let auditIds: number[];
            // The place the saved fact points at, for its pin.
            let savedPlaceId: number | null | undefined;
            if (vital) {
                // Birth and death are columns on the person (Option A). A death save
                // also marks them deceased; its cause rides along.
                const patch = {
                    ...vitalPatchFor(type, date, place, type === 'DEAT' ? detail : undefined),
                    ...(type === 'DEAT' ? { DeathPlaceId: placeId } : { BirthPlaceId: placeId }),
                } as UpdatePersonInput;
                const saved = await client.people.update(person.Id, patch, treeId);
                auditIds = saved.auditIds;
                savedPlaceId = type === 'DEAT' ? saved.DeathPlaceId : saved.BirthPlaceId;
                key = `${type === 'BIRT' ? 'birth' : 'death'}-${person.Id}`;
            } else {
                const body = { Type: type, Date: date || null, Place: place || null, PlaceId: placeId, Description: detail || null, PersonId: person.Id, FamilyId: null };
                const row: GedcomEvent & { auditIds: number[] } = step.fact
                    ? await client.events.update(step.fact.factId, body, treeId)
                    : await client.events.create(body, treeId);
                auditIds = row.auditIds;
                savedPlaceId = row.PlaceId;
                key = `event-${row.Id}`;
                if (isNew && draftMedia.items.length > 0) {
                    try { mediaFailed = (await draftMedia.process(row.Id)).failed.length > 0; } catch { mediaFailed = true; }
                }
            }
            await flushPlace(place, resolution, savedPlaceId);
            return { auditIds };
        }, {
            message: isNew ? t('added', { type: label(type) }) : t('saved', { type: label(type) }),
            detail: when(date, place) || undefined,
        });
        setSaving(false);
        if (!ok) return;
        if (mediaFailed) showErrorToast(t('media_failed'));
        onSaved(key);
        setSaved(draft);
        onClose();
    }

    async function remove() {
        if (step.step !== 'form' || !step.fact) return;
        const f = step.fact;
        setSaving(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            if (f.vital && f.type === 'BIRT') return client.people.update(person.Id, { BirthDate: null, BirthPlace: null }, treeId);
            // Deleting a death leaves the person deceased (#1054 Decisions → Living status).
            if (f.vital) return client.people.update(person.Id, { DeathDate: null, DeathPlace: null, DeathCause: null, IsDeceased: 1 }, treeId);
            return client.events.remove(f.factId, treeId);
        }, { message: t('deleted', { type: label(f.type) }), detail: when(f.date, f.place) || undefined });
        setSaving(false);
        setConfirming(false);
        if (ok) { setSaved(draft); onClose(); }
    }

    /* ── Steps ── */

    if (step.step === 'choose') {
        return (
            <Sheet open={open} onClose={onClose} title={t('add_event')}>
                <div className="grid grid-cols-3 gap-2 pt-1 pb-1">
                    {commonEventTypes(person).map((type) => (
                        <TypeTile key={type} label={label(type)} onClick={() => pick(type, 'choose')} />
                    ))}
                    <TypeTile more label={t('more_types')} onClick={() => setStep({ step: 'more' })} />
                </div>
            </Sheet>
        );
    }

    if (step.step === 'more') {
        const q = query.trim().toLocaleLowerCase();
        const match = (type: string) => !q || label(type).toLocaleLowerCase().includes(q);
        const typed = resolveEventType(query, label);
        const offerCustom = typed?.custom === true;
        const groups = EVENT_TYPE_GROUPS.map((g) => ({ ...g, types: g.types.filter(match) })).filter((g) => g.types.length > 0);
        return (
            <Sheet open={open} onClose={onClose} onBack={() => setStep({ step: 'choose' })} title={t('all_types')} size="full">
                <div className="relative">
                    <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        maxLength={120}
                        enterKeyHint="go"
                        aria-label={t('search_types')}
                        placeholder={t('search_types')}
                        className={cx(fieldClass(), '!pl-9 min-h-11')}
                        onKeyDown={(e) => {
                            if (e.key !== 'Enter' || !typed) return;
                            e.preventDefault();
                            if (!alreadyRecorded(person, typed.type)) pick(typed.type, 'more');
                        }}
                    />
                </div>
                <div className="-mx-4 mt-1">
                    {groups.map((g) => (
                        <div key={g.key}>
                            {!q && <h3 className="eyebrow m-0 px-4 pt-4 pb-1">{t(`group_${g.key}`)}</h3>}
                            {g.types.map((type, i) => {
                                const have = alreadyRecorded(person, type);
                                const count = recordedCount(person, type);
                                return (
                                    <MobileRow
                                        key={type}
                                        divided={i > 0 || Boolean(q)}
                                        label={label(type)}
                                        sub={have ? t('already_recorded') : count > 0 ? t('recorded_count', { count }) : undefined}
                                        disabled={have}
                                        onClick={() => pick(type, 'more')}
                                    />
                                );
                            })}
                        </div>
                    ))}
                    {offerCustom && (
                        <MobileRow divided icon={<Plus />} end="chevron" label={t('add_custom', { name: typed.type })} onClick={() => pick(typed.type, 'more')} />
                    )}
                    {!q && <p className="m-0 px-4 pt-3.5 text-meta text-text-muted">{t('not_listed')}</p>}
                </div>
            </Sheet>
        );
    }

    /* ── The form ── */

    const factLike = step.fact;
    const factDescriptor = factLike ? facts.find((x) => x.factTable === factLike.factTable && x.factId === factLike.factId) : null;
    const citations = factDescriptor?.citations ?? [];
    const persistedEventId = factLike && !factLike.vital ? factLike.factId : null;
    const title = step.fact ? t('edit_title', { type: inline(type) }) : t('add_title', { type: inline(type) });
    const deleteHint = type === 'BIRT' ? t('delete_birth_hint') : type === 'DEAT' ? t('delete_death_hint', { name }) : t('delete_event_hint');
    const detailLabel = type === 'DEAT' ? t('field_cause') : t('field_description');

    return (
        <Sheet
            open={open}
            onClose={onClose}
            onBack={step.from ? back : undefined}
            title={title}
            size="full"
            dirty={dirty}
            onSave={save}
            saveDisabled={saving}
        >
            <div ref={formRef}>
                <div className="grid gap-3 pb-2">
                    <div className="grid gap-1.5">
                        <label htmlFor={`${ids}-date`} className="text-meta font-medium text-text-secondary">{t('field_date')}</label>
                        <DateInput id={`${ids}-date`} value={draft.date} onChange={(date) => setDraft((d) => ({ ...d, date }))} qualifierChips className={cx(fieldClass(), 'min-h-11')} />
                    </div>
                    <div className="grid gap-1.5">
                        <label htmlFor={`${ids}-place`} className="text-meta font-medium text-text-secondary">{t('field_place')}</label>
                        <LocationField
                            id={`${ids}-place`}
                            value={draft.place}
                            onChange={(place) => setDraft((d) => ({ ...d, place }))}
                            onResolve={setResolution}
                            onRemove={() => setResolution(null)}
                            placeId={draft.placeId}
                            onPlaceIdChange={(placeId) => setDraft((d) => (d.placeId === placeId ? d : { ...d, placeId }))}
                            variant="sheet"
                            label={t('field_place')}
                            treeId={treeId}
                            className={cx(fieldClass(), 'min-h-11')}
                            placeholder={t('place_placeholder')}
                        />
                    </div>
                </div>

                <div className="-mx-4 border-t border-border">
                    {showDetail ? (
                        <div className="grid gap-1.5 px-4 pt-3 pb-3">
                            <label htmlFor={`${ids}-detail`} className="text-meta font-medium text-text-secondary">{detailLabel}</label>
                            <input
                                id={`${ids}-detail`}
                                type="text"
                                value={draft.detail}
                                onChange={(e) => setDraft((d) => ({ ...d, detail: e.target.value }))}
                                className={cx(fieldClass(), 'min-h-11')}
                            />
                        </div>
                    ) : (
                        <MobileRow icon={<Pencil />} end="chevron" label={type === 'DEAT' ? t('add_cause') : t('add_description')} onClick={() => {
                            setShowDetail(true);
                            requestAnimationFrame(() => focusField(`${ids}-detail`));
                        }} />
                    )}
                    {/* A recorded birth or death keeps its photos on the person, scoped to
                        the fact (ADR 0030). A new one gets them once it is saved. */}
                    {vital && factLike && (
                        <div className="px-4 pt-3 pb-3 border-t border-border">
                            <h3 className="eyebrow m-0 mb-2">{t('media')}</h3>
                            <OwnerMediaCard ownerTable="People" ownerId={person.Id} ownerFact={type === 'DEAT' ? 'Death' : 'Birth'} treeId={treeId} canEdit canDelete={canDelete} relevantPersonIds={[person.Id]}
                                targetName={displayFullName(person)} targetDate={factLike.date ? formatDateForDisplay(factLike.date, language, words) : null} />
                        </div>
                    )}
                    {!vital && (persistedEventId != null ? (
                        <div className="px-4 pt-3 pb-3 border-t border-border">
                            <h3 className="eyebrow m-0 mb-2">{t('media')}</h3>
                            <OwnerMediaCard ownerTable="Events" ownerId={persistedEventId} treeId={treeId} canEdit canDelete={canDelete} relevantPersonIds={[person.Id]}
                                galleryPersonId={person.Id} targetName={displayFullName(person)} targetPart={label(type)}
                                targetDate={factLike?.date ? formatDateForDisplay(factLike.date, language, words) : null} />
                        </div>
                    ) : showMedia || draftMedia.items.length > 0 ? (
                        <div className="px-4 pt-3 pb-3 border-t border-border">
                            <h3 className="eyebrow m-0 mb-2">{t('media')}</h3>
                            <EventMediaDraftPanel treeId={treeId} draft={draftMedia} relevantPersonIds={[person.Id]} galleryPersonId={person.Id} targetName={displayFullName(person)} targetPart={label(type)} />
                        </div>
                    ) : (
                        <MobileRow divided icon={<Camera />} end="chevron" label={t('attach_media')} onClick={() => setShowMedia(true)} />
                    ))}
                </div>

                {factLike && (
                    <div ref={sourcesRef} className="-mx-4 border-t border-border pt-4 scroll-mt-4">
                        <h3 className="eyebrow m-0 px-4 mb-1">{t('sources')}</h3>
                        {citations.length === 0 && <p className="m-0 px-4 pb-1 text-base text-text-muted">{t('no_source_yet')}</p>}
                        {citations.map((c) => (
                            <div key={c.Id} className="flex items-start gap-2 px-4 py-1.5 text-base leading-snug">
                                <span className={cx(citeClass(), 'shrink-0 mt-0.5')}>{sourceNumbers.get(c.SourceId)}</span>
                                <span className="min-w-0">{c.sourceTitle ?? t('source_fallback')}{c.Page ? <span className="text-text-muted"> · {c.Page}</span> : null}</span>
                            </div>
                        ))}
                        {/* Cite a source opens on top of this sheet, so nothing typed here is lost. */}
                        <MobileRow icon={<Plus />} end="chevron" label={t('cite_source')} onClick={() => setCiting(true)} />
                        {citeSheets(citing && factDescriptor ? { fact: factDescriptor, start: 'pick' } : null, () => setCiting(false))}
                    </div>
                )}

                {factLike && canDelete && (
                    <div className="-mx-4 border-t border-border mt-2">
                        <MobileRow icon={<Trash2 />} tone="danger" label={t('delete_row', { type: inline(type) })} sub={deleteHint} onClick={() => setConfirming(true)} />
                    </div>
                )}

                {factLike && (
                    <ConfirmSheet
                        open={confirming}
                        title={t('delete_confirm_title', { name, type: inline(type) })}
                        body={[
                            t('delete_confirm_what', { what: when(factLike.date, factLike.place) || label(type) }),
                            type === 'DEAT' ? t('delete_confirm_deceased', { name }) : null,
                        ].filter(Boolean).join(' ')}
                        confirmLabel={t('delete_pill', { type: inline(type) })}
                        onConfirm={remove}
                        onClose={() => setConfirming(false)}
                        busy={saving}
                    />
                )}
            </div>
        </Sheet>
    );
}

const isKnownType = (type: string) => type === 'EVEN' || EVENT_TYPE_GROUPS.some((g) => g.types.includes(type));

function TypeTile({ label, more = false, onClick }: { label: string; more?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cx(
                'grid place-items-center min-h-[52px] px-1.5 py-3 rounded-[14px] border text-sm font-semibold text-center cursor-pointer focus-ring transition-colors',
                more ? 'border-dashed border-border text-link bg-transparent active:bg-surface-2' : 'border-border bg-[color:var(--surface)] text-text active:bg-surface-2',
            )}
        >
            {label}
        </button>
    );
}
