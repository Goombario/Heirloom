'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FamilyType, GedcomEvent } from '@/lib/db/schema';
import type { HierarchyLevel } from '@/lib/geocode/photon';
import { getDataClient } from '@/lib/data';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { formatDateForDisplay } from '@/lib/date-utils';
import DateInput from '@/app/components/DateInput';
import LocationField from '@/app/components/LocationField';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { usePlaceResolutionFlush } from '@/app/components/usePlaceResolutionFlush';
import { OwnerMediaCard } from '@/app/components/media/OwnerMediaCard';
import EventMediaDraftPanel from '@/app/components/media/EventMediaDraftPanel';
import { useEventMediaDraft } from '@/app/components/media/useEventMediaDraft';
import { FAMILY_EVENT_TYPES } from '@/app/components/familyEventTypes';
import type { CitationFactDescriptor } from '@/app/components/citations/types';
import type { CiteSheetsSlot } from '@/app/components/citations/CiteSheets';
import type { SourceNumbers } from '@/app/components/citations/factDescriptors';
import { MobileRow, cx, fieldClass, showErrorToast } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { Camera, Pencil, Trash2 } from '@/lib/icons';
import type { RunChange } from '@/app/people/view/mobile/useChange';
import { END_REASON_TAGS, endReasonOf, partnerShortName } from '../derive';
import { COMMON_FAMILY_EVENTS, endingOf, isEndType, kindKey, type EndType, type PhoneFamily } from './model';
import { ftypeKey, useFamilyEventLabel } from './panes';
import { ChipGroup, Group, SheetSources } from './parts';

/*
 * The family page's event sheets on the phone (#1062): when and where it started
 * (the family's own columns), how it ended (a divorce, annulment or separation), and
 * every other family event. Add event opens on a chooser of common types.
 */

/** Which field a vitals panel row asked for. */
export type FamilyEventFocus = 'type' | 'date' | 'place' | 'sources';

/** What opened the sheet. */
export type FamilyEventFlow =
    | { kind: 'start'; focus?: FamilyEventFocus }
    | { kind: 'end'; focus?: FamilyEventFocus; reason?: Reason }
    | { kind: 'choose' }
    | { kind: 'add'; type: string }
    | { kind: 'edit'; event: GedcomEvent };

type Reason = 'Divorce' | 'Annulment' | 'Separation';
const REASONS: Reason[] = ['Divorce', 'Annulment', 'Separation'];
const REASON_OF: Record<EndType, Reason> = { DIV: 'Divorce', ANUL: 'Annulment', SEPA: 'Separation' };
const FAMILY_TYPES: FamilyType[] = ['Marriage', 'Civil union', 'Common-law', 'Other', 'Unknown'];

type Step =
    | { step: 'choose' }
    | { step: 'more' }
    | { step: 'start' }
    | { step: 'end'; reason: Reason | null; from: 'choose' | 'more' | null }
    | { step: 'event'; type: string; event: GedcomEvent | null; from: 'choose' | 'more' | null };

/** `placeId`: the place the fact links to (#1186), saved or picked. */
interface Draft { type: string; date: string; place: string; placeId: number | null; detail: string }

export interface FamilyEventSheetProps {
    flow: FamilyEventFlow | null;
    onClose: () => void;
    data: PhoneFamily;
    treeId: number | null;
    language: string;
    /** Editors delete; contributors don't (#1054 Roles). */
    canDelete: boolean;
    facts: CitationFactDescriptor[];
    sourceNumbers: SourceNumbers;
    run: RunChange;
    citeSheets: CiteSheetsSlot;
    /** The changed row or cell, so it flashes once. */
    onSaved: (key: string) => void;
    relevantPersonIds: number[];
}

export function FamilyEventSheet(props: FamilyEventSheetProps) {
    // A fresh flow starts a fresh sheet; the last one stays mounted while it closes.
    const [prev, setPrev] = useState<FamilyEventFlow | null>(null);
    const [shown, setShown] = useState<{ flow: FamilyEventFlow; n: number } | null>(null);
    if (props.flow !== prev) {
        setPrev(props.flow);
        const next = props.flow;
        if (next) setShown((s) => ({ flow: next, n: (s?.n ?? 0) + 1 }));
    }
    if (!shown) return null;
    return <Body key={shown.n} {...props} open={props.flow != null} flow={shown.flow} />;
}

function firstStep(flow: FamilyEventFlow, data: PhoneFamily): Step {
    switch (flow.kind) {
        case 'choose': return { step: 'choose' };
        case 'start': return { step: 'start' };
        case 'end': {
            const ending = endingOf(data);
            return { step: 'end', reason: ending?.kind === 'event' ? ending.reason : flow.reason ?? null, from: null };
        }
        case 'add': return { step: 'event', type: flow.type, event: null, from: null };
        case 'edit': return { step: 'event', type: flow.event.Type, event: flow.event, from: null };
    }
}

/** The event the "How it ended" sheet edits: the recorded ending, if there is one. */
function endEvent(data: PhoneFamily): GedcomEvent | null {
    const ending = endingOf(data);
    return ending?.kind === 'event' ? ending.event : null;
}

function draftOf(step: Step, data: PhoneFamily): Draft {
    if (step.step === 'start') return { type: data.family.Type ?? 'Unknown', date: data.family.MarriageDate ?? '', place: data.family.MarriagePlace ?? '', placeId: data.family.MarriagePlaceId ?? null, detail: '' };
    if (step.step === 'end') {
        const ev = endEvent(data);
        return { type: step.reason ?? '', date: ev?.Date ?? '', place: ev?.Place ?? '', placeId: ev?.PlaceId ?? null, detail: ev?.Description ?? '' };
    }
    if (step.step === 'event' && step.event) return { type: step.type, date: step.event.Date ?? '', place: step.event.Place ?? '', placeId: step.event.PlaceId ?? null, detail: step.event.Description ?? '' };
    return { type: step.step === 'event' ? step.type : '', date: '', place: '', placeId: null, detail: '' };
}

function Body({ open, flow, onClose, data, treeId, language, canDelete, facts, sourceNumbers, run, citeSheets, onSaved, relevantPersonIds }:
    Omit<FamilyEventSheetProps, 'flow'> & { open: boolean; flow: FamilyEventFlow }) {
    const t = useTranslations('familyPhone');
    const te = useTranslations('mobileEvents');
    const tf = useTranslations('mobileFamily');
    const tp = useTranslations('mobilePerson');
    const label = useFamilyEventLabel();
    const words = useDateQualifierWords();
    const flushPlace = usePlaceResolutionFlush(treeId);
    const draftMedia = useEventMediaDraft({ treeId });
    const ids = useId();
    const { family } = data;
    const [step, setStep] = useState<Step>(() => firstStep(flow, data));
    const [draft, setDraft] = useState<Draft>(() => draftOf(firstStep(flow, data), data));
    const [saved, setSaved] = useState<Draft>(() => draftOf(firstStep(flow, data), data));
    const [resolution, setResolution] = useState<HierarchyLevel[] | null | undefined>(undefined);
    const [showDetail, setShowDetail] = useState(() => Boolean(draftOf(firstStep(flow, data), data).detail));
    const [showMedia, setShowMedia] = useState(false);
    const [saving, setSaving] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [citing, setCiting] = useState(false);
    const formRef = useRef<HTMLDivElement>(null);
    const sourcesRef = useRef<HTMLDivElement>(null);
    const typeRef = useRef<HTMLDivElement>(null);
    const focusField = (id: string) => formRef.current?.querySelector<HTMLElement>(`[id="${id}"]`)?.focus();

    const isForm = step.step === 'start' || step.step === 'end' || step.step === 'event';
    const dirty = isForm && (draft.type !== saved.type || draft.date !== saved.date || draft.place !== saved.place || draft.placeId !== saved.placeId
        || draft.detail !== saved.detail || resolution !== undefined || draftMedia.items.length > 0);
    const startType = (family.Type ?? 'Unknown') as FamilyType;
    const kindWord = t(`kind_${kindKey(step.step === 'start' ? draft.type as FamilyType : startType)}`);
    const when = (d: string | null | undefined, p: string | null | undefined) =>
        [d ? formatDateForDisplay(d, language, words) : null, p?.split(',')[0]?.trim() || null].filter(Boolean).join(' · ');

    // A vitals row that asked for a field opens with it focused; a new event on Date.
    useEffect(() => {
        if (!isForm) return;
        const asked = flow.kind === 'start' || flow.kind === 'end' ? flow.focus : undefined;
        const firstForm = (flow.kind === 'start' && step.step === 'start') || (flow.kind === 'end' && step.step === 'end');
        const focus = firstForm ? asked : step.step === 'event' && !step.event ? 'date' : step.step === 'end' && !endEvent(data) && step.from ? 'date' : undefined;
        if (!focus) return;
        const timer = window.setTimeout(() => {
            if (focus === 'sources') { sourcesRef.current?.scrollIntoView({ block: 'start' }); return; }
            if (focus === 'type') { typeRef.current?.querySelector<HTMLElement>('button')?.focus(); return; }
            requestAnimationFrame(() => focusField(`${ids}-${focus}`));
        }, 320);
        return () => window.clearTimeout(timer);
        // Only when a form opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step]);

    const goForm = (next: Step) => {
        setStep(next);
        const d = draftOf(next, data);
        setDraft(d); setSaved(d); setResolution(undefined); setShowDetail(false);
    };
    const pickType = (type: string, from: 'choose' | 'more') => {
        // An ending opens How it ended, unless one is recorded already: then it's an event like any other.
        if (isEndType(type) && !endEvent(data)) goForm({ step: 'end', reason: REASON_OF[type], from });
        else goForm({ step: 'event', type, event: null, from });
    };
    const back = () => {
        if (step.step === 'more') setStep({ step: 'choose' });
        else if ((step.step === 'event' || step.step === 'end') && step.from) {
            setStep(step.from === 'more' ? { step: 'more' } : { step: 'choose' });
            setResolution(undefined);
        }
    };

    /* ── Writes ── */

    async function saveStart() {
        if (saving) return;
        setSaving(true);
        const date = draft.date.trim(), place = draft.place.trim();
        const type = draft.type as FamilyType;
        const ok = await run(async () => {
            const client = await getDataClient();
            const row = await client.families.update(family.Id, { Type: type, MarriageDate: date || null, MarriagePlace: place || null, MarriagePlaceId: place ? draft.placeId : null }, treeId);
            await flushPlace(place, resolution, row.MarriagePlaceId);
            return row;
        }, { message: t(type === 'Marriage' ? 'marriage_saved' : 'partnership_saved'), detail: when(date, place) || undefined });
        setSaving(false);
        if (!ok) return;
        onSaved('cell-start');
        setSaved(draft);
        onClose();
    }

    async function clearStart() {
        setSaving(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            return client.families.update(family.Id, { MarriageDate: null, MarriagePlace: null }, treeId);
        }, { message: t('start_cleared', { what: tf(startType === 'Marriage' ? 'married' : 'started') }), detail: when(family.MarriageDate, family.MarriagePlace) || undefined });
        setSaving(false);
        setConfirming(false);
        if (ok) { setSaved(draft); onClose(); }
    }

    async function saveEnd() {
        if (saving || !draft.type) return;
        setSaving(true);
        const reason = draft.type as Reason;
        const ev = endEvent(data);
        const date = draft.date.trim(), place = draft.place.trim();
        let key = 'cell-end';
        const ok = await run(async () => {
            const client = await getDataClient();
            let row: GedcomEvent & { auditIds: number[] };
            if (ev) {
                // Retype only when the reason changed, so a DIVF (divorce filed) stays one.
                const patch = { Date: date || null, Place: place || null, PlaceId: place ? draft.placeId : null, ...(endReasonOf(ev.Type) !== reason ? { Type: END_REASON_TAGS[reason] } : {}) };
                row = await client.events.update(ev.Id, patch, treeId);
            } else {
                row = await client.events.create({ Type: END_REASON_TAGS[reason], Date: date || null, Place: place || null, PlaceId: place ? draft.placeId : null, FamilyId: family.Id }, treeId);
                key = 'cell-end';
            }
            await flushPlace(place, resolution, row.PlaceId);
            return row;
        }, { message: t(ev ? 'end_saved' : 'end_recorded', { reason }), detail: when(date, place) || undefined });
        setSaving(false);
        if (!ok) return;
        onSaved(key);
        setSaved(draft);
        onClose();
    }

    async function saveEvent() {
        if (step.step !== 'event' || saving) return;
        setSaving(true);
        const isNew = !step.event;
        const type = step.type;
        const date = draft.date.trim(), place = draft.place.trim(), detail = draft.detail.trim();
        let key = '';
        let mediaFailed = false;
        const ok = await run(async () => {
            const client = await getDataClient();
            const body = { Type: type, Date: date || null, Place: place || null, PlaceId: place ? draft.placeId : null, Description: detail || null, FamilyId: family.Id, PersonId: null };
            const row = step.event ? await client.events.update(step.event.Id, body, treeId) : await client.events.create(body, treeId);
            key = `event-${row.Id}`;
            if (isNew && draftMedia.items.length > 0) {
                try { mediaFailed = (await draftMedia.process(row.Id)).failed.length > 0; } catch { mediaFailed = true; }
            }
            await flushPlace(place, resolution, row.PlaceId);
            return row;
        }, { message: isNew ? te('added', { type: label(type) }) : te('saved', { type: label(type) }), detail: when(date, place) || undefined });
        setSaving(false);
        if (!ok) return;
        if (mediaFailed) showErrorToast(te('media_failed'));
        onSaved(key);
        setSaved(draft);
        onClose();
    }

    async function removeEvent(ev: GedcomEvent) {
        setSaving(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            return client.events.remove(ev.Id, treeId);
        }, { message: te('deleted', { type: label(ev.Type) }), detail: when(ev.Date, ev.Place) || undefined });
        setSaving(false);
        setConfirming(false);
        if (ok) { setSaved(draft); onClose(); }
    }

    /* ── Chooser ── */

    if (step.step === 'choose') {
        return (
            <Sheet open={open} onClose={onClose} title={t('add_family_event')}>
                <div className="grid grid-cols-3 gap-2 pt-1 pb-1">
                    {COMMON_FAMILY_EVENTS.map((type) => <TypeTile key={type} label={label(type)} onClick={() => pickType(type, 'choose')} />)}
                    <TypeTile more label={te('more_types')} onClick={() => setStep({ step: 'more' })} />
                </div>
                <p className="m-0 pt-3 pb-1 text-meta text-text-muted">{t('chooser_hint')}</p>
            </Sheet>
        );
    }

    if (step.step === 'more') {
        return (
            <Sheet open={open} onClose={onClose} onBack={() => setStep({ step: 'choose' })} title={te('all_types')}>
                <div className="-mx-4">
                    {FAMILY_EVENT_TYPES.map((x, i) => (
                        <MobileRow key={x.value} divided={i > 0} label={label(x.value)} onClick={() => pickType(x.value, 'more')} />
                    ))}
                </div>
            </Sheet>
        );
    }

    /* ── Forms ── */

    const dateField = (
        <div className="grid gap-1.5">
            <label htmlFor={`${ids}-date`} className="text-meta font-medium text-text-secondary">{te('field_date')}</label>
            <DateInput id={`${ids}-date`} value={draft.date} onChange={(date) => setDraft((d) => ({ ...d, date }))} touch className={cx(fieldClass(), 'min-h-11')} />
        </div>
    );
    const placeField = (
        <div className="grid gap-1.5">
            <label htmlFor={`${ids}-place`} className="text-meta font-medium text-text-secondary">{te('field_place')}</label>
            <LocationField
                id={`${ids}-place`}
                value={draft.place}
                onChange={(place) => setDraft((d) => ({ ...d, place }))}
                onResolve={setResolution}
                onRemove={() => setResolution(null)}
                placeId={draft.placeId}
                onPlaceIdChange={(placeId) => setDraft((d) => (d.placeId === placeId ? d : { ...d, placeId }))}
                variant="sheet"
                label={te('field_place')}
                treeId={treeId}
                className={cx(fieldClass(), 'min-h-11')}
                placeholder={te('place_placeholder')}
            />
        </div>
    );
    const citationsOf = (factTable: string, factId: number) => facts.find((x) => x.factTable === factTable && x.factId === factId)?.citations ?? [];
    const sourcesGroup = (factTable: string, factId: number, extra: { factTable: string; factId: number }[] = []) => {
        const descriptor = facts.find((x) => x.factTable === factTable && x.factId === factId);
        const citations = [factTable, ...extra.map((x) => x.factTable)].flatMap((ft, i) => citationsOf(ft, i === 0 ? factId : extra[i - 1].factId));
        return (
            <div ref={sourcesRef} className="-mx-4 border-t border-border pt-4 mt-2 scroll-mt-4">
                <h3 className="eyebrow m-0 px-4 mb-1">{te('sources')}</h3>
                {/* Cite a source opens on top of this sheet, so nothing typed here is lost. */}
                <SheetSources citations={citations} sourceNumbers={sourceNumbers} onCite={() => setCiting(true)} />
                {citeSheets(citing && descriptor ? { fact: descriptor, start: 'pick' } : null, () => setCiting(false))}
            </div>
        );
    };
    const deleteRow = (labelText: string, sub: string) => (
        <div className="-mx-4 border-t border-border mt-2">
            <MobileRow icon={<Trash2 />} tone="danger" label={labelText} sub={sub} onClick={() => setConfirming(true)} />
        </div>
    );

    if (step.step === 'start') {
        const hasStart = Boolean(family.MarriageDate || family.MarriagePlace);
        const kind = kindWord.toLocaleLowerCase(language);
        const title = t(hasStart ? 'edit_kind' : 'add_kind', { kind: language.startsWith('en') ? kind : kindWord });
        return (
            <Sheet open={open} onClose={onClose} title={title} size="full" dirty={dirty} onSave={saveStart} saveDisabled={saving}>
                <div ref={formRef}>
                    <Group first title={t('row_type')}>
                        <div ref={typeRef}>
                            <ChipGroup label={t('row_type')} value={draft.type} onChange={(type) => setDraft((d) => ({ ...d, type }))}
                                options={FAMILY_TYPES.map((v) => ({ v, l: tf(`ftype_${ftypeKey(v)}`) }))} />
                        </div>
                        <p className="m-0 text-meta text-text-muted">{t('type_hint')}</p>
                    </Group>
                    <Group>
                        {dateField}
                        {placeField}
                    </Group>
                    {sourcesGroup(FACT_TABLES.FAMILIES, family.Id, [{ factTable: FACT_TABLES.FAMILY_MARRIAGE, factId: family.Id }])}
                    {/* The marriage's own photos, on the family scoped to it (ADR 0030). */}
                    <div className="-mx-4 px-4 pt-3 pb-3 border-t border-border">
                        <h3 className="eyebrow m-0 mb-2">{te('media')}</h3>
                        <OwnerMediaCard ownerTable="Families" ownerId={family.Id} ownerFact="Marriage" treeId={treeId} canEdit canDelete={canDelete} relevantPersonIds={relevantPersonIds} />
                    </div>
                    {hasStart && canDelete && deleteRow(t('clear_start'), t('clear_start_sub', { what: tf(startType === 'Marriage' ? 'married' : 'started') }))}
                    <ConfirmSheet
                        open={confirming}
                        title={t('clear_start_title', { kind: language.startsWith('en') ? kind : kindWord })}
                        body={t('clear_start_body', { what: when(family.MarriageDate, family.MarriagePlace) || kindWord })}
                        confirmLabel={t('clear_start_pill')}
                        onConfirm={clearStart}
                        onClose={() => setConfirming(false)}
                        busy={saving}
                    />
                </div>
            </Sheet>
        );
    }

    if (step.step === 'end') {
        const ev = endEvent(data);
        const ending = endingOf(data);
        const reasonWord = draft.type ? t(`reason_${draft.type}`) : '';
        const lower = (s: string) => (language.startsWith('en') ? s.toLocaleLowerCase('en') : s);
        const title = ev ? t('edit_end_title', { reason: lower(t(`reason_${endReasonOf(ev.Type) ?? 'Divorce'}`)) }) : t('how_it_ended');
        return (
            <Sheet open={open} onClose={onClose} onBack={step.from ? back : undefined} title={title} size="full" dirty={dirty}
                onSave={saveEnd} saveLabel={ev ? undefined : tf('add')} saveDisabled={saving || !draft.type}
                saveWhenClean={!ev && Boolean(draft.type)}>
                <div ref={formRef}>
                    {ending?.kind === 'death' && (
                        <div className="mt-4 p-3 rounded-xl bg-[color:var(--surface)] text-sm leading-snug text-text-secondary">
                            {t.rich('ends_with_death', {
                                name: partnerShortName(ending.partner) || tp('unknown'),
                                year: formatDateForDisplay(ending.date ?? '', language, words) || '?',
                                b: (chunks) => <b className="font-semibold text-text">{chunks}</b>,
                            })}
                        </div>
                    )}
                    <Group first={ending?.kind !== 'death'} title={t('what_happened')}>
                        <div ref={typeRef}>
                            <ChipGroup label={t('what_happened')} value={(draft.type || null) as Reason | null} onChange={(type) => setDraft((d) => ({ ...d, type }))}
                                options={REASONS.map((v) => ({ v, l: t(`reason_${v}`) }))} />
                        </div>
                    </Group>
                    <Group>
                        {dateField}
                        {placeField}
                    </Group>
                    {ev && sourcesGroup(FACT_TABLES.EVENTS, ev.Id)}
                    {ev && canDelete && deleteRow(t('delete_end', { reason: lower(reasonWord || t(`reason_${endReasonOf(ev.Type) ?? 'Divorce'}`)) }),
                        ending?.kind === 'event' && data.partner1 && data.partner2 && [data.partner1, data.partner2].some((p) => p?.DeathDate) ? t('delete_end_sub_death') : t('delete_end_sub'))}
                    {ev && (
                        <ConfirmSheet
                            open={confirming}
                            title={t('delete_end_title', { reason: lower(t(`reason_${endReasonOf(ev.Type) ?? 'Divorce'}`)) })}
                            body={te('delete_confirm_what', { what: when(ev.Date, ev.Place) || t(`reason_${endReasonOf(ev.Type) ?? 'Divorce'}`) })}
                            confirmLabel={t('delete_end_pill', { reason: lower(t(`reason_${endReasonOf(ev.Type) ?? 'Divorce'}`)) })}
                            onConfirm={() => removeEvent(ev)}
                            onClose={() => setConfirming(false)}
                            busy={saving}
                        />
                    )}
                </div>
            </Sheet>
        );
    }

    // Any other family event.
    const ev = step.event;
    const typeLabel = label(step.type);
    const inline = language.startsWith('en') ? typeLabel.toLocaleLowerCase('en') : typeLabel;
    return (
        <Sheet open={open} onClose={onClose} onBack={step.from ? back : undefined} title={ev ? te('edit_title', { type: inline }) : te('add_title', { type: inline })}
            size="full" dirty={dirty} onSave={saveEvent} saveDisabled={saving}>
            <div ref={formRef}>
                <Group first>
                    {dateField}
                    {placeField}
                </Group>
                <div className="-mx-4 border-t border-border mt-2">
                    {showDetail ? (
                        <div className="grid gap-1.5 px-4 pt-3 pb-3">
                            <label htmlFor={`${ids}-detail`} className="text-meta font-medium text-text-secondary">{te('field_description')}</label>
                            <input id={`${ids}-detail`} type="text" value={draft.detail} onChange={(e) => setDraft((d) => ({ ...d, detail: e.target.value }))}
                                className={cx(fieldClass(), 'min-h-11')} />
                        </div>
                    ) : (
                        <MobileRow icon={<Pencil />} end="chevron" label={te('add_description')} onClick={() => {
                            setShowDetail(true);
                            requestAnimationFrame(() => focusField(`${ids}-detail`));
                        }} />
                    )}
                    {ev ? (
                        <div className="px-4 pt-3 pb-3 border-t border-border">
                            <h3 className="eyebrow m-0 mb-2">{te('media')}</h3>
                            <OwnerMediaCard ownerTable="Events" ownerId={ev.Id} treeId={treeId} canEdit canDelete={canDelete} relevantPersonIds={relevantPersonIds} />
                        </div>
                    ) : showMedia || draftMedia.items.length > 0 ? (
                        <div className="px-4 pt-3 pb-3 border-t border-border">
                            <h3 className="eyebrow m-0 mb-2">{te('media')}</h3>
                            <EventMediaDraftPanel treeId={treeId} draft={draftMedia} relevantPersonIds={relevantPersonIds} />
                        </div>
                    ) : (
                        <MobileRow divided icon={<Camera />} end="chevron" label={te('attach_media')} onClick={() => setShowMedia(true)} />
                    )}
                </div>
                {ev && sourcesGroup(FACT_TABLES.EVENTS, ev.Id)}
                {ev && canDelete && deleteRow(te('delete_row', { type: inline }), te('delete_event_hint'))}
                {ev && (
                    <ConfirmSheet
                        open={confirming}
                        title={t('delete_event_title', { type: inline })}
                        body={te('delete_confirm_what', { what: when(ev.Date, ev.Place) || typeLabel })}
                        confirmLabel={te('delete_pill', { type: inline })}
                        onConfirm={() => removeEvent(ev)}
                        onClose={() => setConfirming(false)}
                        busy={saving}
                    />
                )}
            </div>
        </Sheet>
    );
}

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
