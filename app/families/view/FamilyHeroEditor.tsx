'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import PersonPicker from '@/app/components/PersonPicker';
import DateInput from '@/app/components/DateInput';
import { factPlaceEntry, factPlaceKey } from '@/lib/places/place-key';
import LocationField from '@/app/components/LocationField';
import { FieldLabel, HeroEditorPanel, HeroEditorRow, SegmentedControl, fieldClass } from '@/app/components/ui';
import { getDataClient } from '@/lib/data';
import type { PinChainRow } from '@/lib/data/types';
import type { HierarchyLevel } from '@/lib/geocode/photon';
import type { FamilyType, PersonResult } from '@/lib/db/schema';
import type { PartnerPerson } from './useFamilyDetail';
import { endReasonOf } from './derive';

export type EndReason = 'Divorce' | 'Annulment' | 'Separation';

export interface FamilyHeroPatch {
    Partner1Id: number | null;
    Partner2Id: number | null;
    Type: FamilyType;
    MarriageDate: string | null;
    MarriagePlace: string | null;
    /** The place picked for MarriagePlace (#1186). */
    MarriagePlaceId: number | null;
    /** LocationField's pending resolution for MarriagePlace, flushed after the save. */
    placeResolution: HierarchyLevel[] | null | undefined;
    /** The explicit end, or null for none recorded. */
    end: { reason: EndReason; date: string | null } | null;
}

interface FamilyHeroEditorProps {
    partner1: PartnerPerson | null;
    partner2: PartnerPerson | null;
    type: FamilyType;
    marriageDate: string | null;
    marriagePlace: string | null;
    /** The place the marriage points at (#1186). */
    marriagePlaceId?: number | null;
    /** The divorce/annulment/separation event the hero shows (`endEventOf`), if any. */
    endEvent: { Type: string; Date: string | null } | null;
    treeId: number | null;
    saving: boolean;
    /** 'owner'/'edit' only — 'contribute' can write but the server rejects deletes. */
    canDelete: boolean;
    onSave: (patch: FamilyHeroPatch) => Promise<void>;
    onCancel: () => void;
    onDelete: () => void;
}

/**
 * The family hero's edit panel (FamilyDetailView owns the editing state): the
 * partnership analog of the person hero's HeroIdentityEditor, on the same
 * HeroEditorPanel layout (#759). Edits the partners, the type, when and where it
 * started, and how it ended. At least one partner is required.
 */
export function FamilyHeroEditor({
    partner1, partner2, type, marriageDate, marriagePlace, marriagePlaceId = null, endEvent, treeId, saving, canDelete, onSave, onCancel, onDelete,
}: FamilyHeroEditorProps) {
    const t = useTranslations('editFamily');
    const tc = useTranslations('common');
    // Internal state is PersonResult (PersonPicker's value/onChange shape); PartnerPerson
    // props are assignable to it. Only the picked Id is read back on save.
    const [p1, setP1] = useState<PersonResult | null>(partner1);
    const [p2, setP2] = useState<PersonResult | null>(partner2);
    const [famType, setFamType] = useState<FamilyType>(type);
    const [date, setDate] = useState(marriageDate ?? '');
    const [place, setPlace] = useState(marriagePlace ?? '');
    const [placeResolution, setPlaceResolution] = useState<HierarchyLevel[] | null | undefined>(undefined);
    const [placeChains, setPlaceChains] = useState<Record<string, PinChainRow[]>>({});
    // The place the marriage links to (#1186): the saved one, then the one picked.
    const [placeId, setPlaceId] = useState<number | null>(marriagePlaceId);
    const initialReason = endEvent ? endReasonOf(endEvent.Type) : null;
    const [endReason, setEndReason] = useState<EndReason | ''>(
        initialReason === 'Divorce' || initialReason === 'Annulment' || initialReason === 'Separation' ? initialReason : '',
    );
    const [endDate, setEndDate] = useState(endEvent?.Date ?? '');
    const [noPartnerError, setNoPartnerError] = useState(false);
    const fieldId = useId();
    const dirty = (p1?.Id ?? null) !== (partner1?.Id ?? null) || (p2?.Id ?? null) !== (partner2?.Id ?? null)
        || famType !== type || date !== (marriageDate ?? '') || place !== (marriagePlace ?? '') || placeId !== marriagePlaceId
        || endReason !== (initialReason === 'Divorce' || initialReason === 'Annulment' || initialReason === 'Separation' ? initialReason : '')
        || endDate !== (endEvent?.Date ?? '');

    // Read-only lookup for the saved place's pin chain, so the field shows its badge.
    useEffect(() => {
        // By the place the marriage points at: two places may share a name (#1186).
        const key = factPlaceKey(marriagePlace, marriagePlaceId);
        if (key == null) return;
        let cancelled = false;
        (async () => {
            try {
                const client = await getDataClient();
                const chains = await client.places.pinChains([key], treeId);
                if (!cancelled) setPlaceChains(chains);
            } catch {
                // Best-effort — a failed lookup just means no badge shows this session.
            }
        })();
        return () => { cancelled = true; };
    }, [marriagePlace, marriagePlaceId, treeId]);

    const handleSave = () => {
        if (!p1 && !p2) { setNoPartnerError(true); return; }
        setNoPartnerError(false);
        onSave({
            Partner1Id: p1?.Id ?? null,
            Partner2Id: p2?.Id ?? null,
            Type: famType,
            MarriageDate: date || null,
            MarriagePlace: place || null,
            MarriagePlaceId: place ? placeId : null,
            placeResolution,
            end: endReason ? { reason: endReason, date: endDate || null } : null,
        });
    };

    return (
        <HeroEditorPanel
            onSave={handleSave}
            onCancel={onCancel}
            saving={saving}
            dirty={dirty}
            onDelete={canDelete ? onDelete : undefined}
            deleteLabel={`${t('delete_partnership')}…`}
        >
            <fieldset className="m-0 p-0 border-0 min-w-0">
                <legend className="block text-meta font-medium text-[color:var(--text-2)] mb-1 p-0">{t('section_partners')}</legend>
                <HeroEditorRow>
                    <PersonPicker value={p1} onChange={(pp) => { setP1(pp); setNoPartnerError(false); }} changeable showSex showDates excludeIds={p2 ? [p2.Id] : []} treeId={treeId} inline placeholder={t('search_partner_n', { index: 1 })} />
                    <PersonPicker value={p2} onChange={(pp) => { setP2(pp); setNoPartnerError(false); }} changeable showSex showDates excludeIds={p1 ? [p1.Id] : []} treeId={treeId} inline placeholder={t('search_partner_n', { index: 2 })} />
                </HeroEditorRow>
            </fieldset>
            {noPartnerError && (
                <div role="alert" className="text-meta" style={{ color: 'var(--color-error)' }}>{t('err_one_partner_required')}</div>
            )}
            <FieldLabel label={t('type_label')}>
                <SegmentedControl
                    value={famType}
                    onChange={(v) => setFamType(v as FamilyType)}
                    aria-label={t('type_label')}
                    // Five and four options outgrow a phone-width hero: wrap, not overflow.
                    className="flex-wrap !h-auto max-w-full"
                    options={[
                        { v: 'Unknown', l: tc('unknown') },
                        { v: 'Marriage', l: t('type_marriage') },
                        { v: 'Civil union', l: t('type_civil_union') },
                        { v: 'Common-law', l: t('type_common_law') },
                        { v: 'Other', l: t('type_other') },
                    ]}
                />
            </FieldLabel>
            <fieldset className="m-0 p-0 border-0 min-w-0">
                <legend className="block text-meta font-medium text-[color:var(--text-2)] mb-1 p-0">{t('section_started')}</legend>
                <HeroEditorRow>
                    <div>
                        <label className="sr-only" htmlFor={`${fieldId}-start-date`}>{t('date_label')}</label>
                        <DateInput id={`${fieldId}-start-date`} value={date} onChange={setDate} className={fieldClass()} />
                    </div>
                    <div>
                        <label className="sr-only" htmlFor={`${fieldId}-start-place`}>{t('place_label')}</label>
                        <LocationField
                            id={`${fieldId}-start-place`}
                            value={place}
                            onChange={setPlace}
                            onResolve={setPlaceResolution}
                            onRemove={() => setPlaceResolution(null)}
                            initialChain={factPlaceEntry(placeChains, place, placeId) ?? null}
                            placeId={placeId}
                            onPlaceIdChange={setPlaceId}
                            treeId={treeId}
                            className={fieldClass()}
                            placeholder={t('place_placeholder')}
                        />
                    </div>
                </HeroEditorRow>
            </fieldset>
            <fieldset className="m-0 p-0 border-0 min-w-0">
                <legend className="block text-meta font-medium text-[color:var(--text-2)] mb-1 p-0">{t('section_ended')}</legend>
                <HeroEditorRow>
                    {/* Wrapped: HeroEditorRow grows its children, and the control should
                        keep its own width. */}
                    <div>
                        <SegmentedControl
                            value={endReason}
                            onChange={(v) => setEndReason(v as EndReason | '')}
                            aria-label={t('section_ended')}
                            // Five and four options outgrow a phone-width hero: wrap, not overflow.
                            className="flex-wrap !h-auto max-w-full"
                            options={[
                                // An existing end event is cleared from the timeline, where its
                                // citations and media show; the hero only retypes or re-dates it.
                                ...(endEvent ? [] : [{ v: '', l: t('ended_unrecorded') }]),
                                { v: 'Divorce', l: t('reason_divorce') },
                                { v: 'Separation', l: t('reason_separation') },
                                { v: 'Annulment', l: t('reason_annulment') },
                            ]}
                        />
                    </div>
                    {endReason && (
                        <div>
                            <label className="sr-only" htmlFor={`${fieldId}-end-date`}>{t('ended_date')}</label>
                            <DateInput id={`${fieldId}-end-date`} value={endDate} onChange={setEndDate} className={fieldClass()} />
                        </div>
                    )}
                </HeroEditorRow>
            </fieldset>
        </HeroEditorPanel>
    );
}
