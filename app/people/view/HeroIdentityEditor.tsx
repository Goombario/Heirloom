'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PersonWithRelations } from '@/lib/db/schema';
import type { PinChainRow } from '@/lib/data/types';
import type { HierarchyLevel } from '@/lib/geocode/photon';
import { getDataClient } from '@/lib/data';
import { useTree } from '@/app/contexts/TreeContext';
import DateInput from '@/app/components/DateInput';
import { factPlaceEntry, factPlaceKey, uniquePlaceKeys } from '@/lib/places/place-key';
import LocationField from '@/app/components/LocationField';
import { ClearDeathConfirm } from '@/app/components/person-form/ClearDeathConfirm';
import { statusDropsDeath } from '@/app/components/person-form/vitalEvent';
import { FieldLabel, HeroEditorPanel, HeroEditorRow, Input, SegmentedControl, fieldClass } from '@/app/components/ui';

type VitalKey = 'BirthDate' | 'BirthPlace' | 'DeathDate' | 'DeathPlace';
type PlaceResolution = HierarchyLevel[] | null | undefined;

/** What the hero's inline editor saves. `vitals` holds only the birth and death
 *  columns the user changed, with a blank value as `null`; they are the same
 *  People columns the timeline's Birth and Death rows edit (ED-5). */
interface PersonIdentityPatch {
    FirstName: string;
    LastName: string;
    Sex: 'M' | 'F' | 'X' | '';
    IsDeceased: '0' | '1' | '';
    vitals: Partial<Record<VitalKey, string | null>>;
    /** Living or Unknown was confirmed over death details: clear DeathDate, DeathPlace and DeathCause (#895). */
    clearDeath: boolean;
    /** Pending pin resolutions, flushed after the save succeeds (LocationField). */
    placeResolutions: { BirthPlace: PlaceResolution; DeathPlace: PlaceResolution };
    /** The place each fact links to (#1186), for the facts whose place the user changed. */
    placeIds: { BirthPlaceId?: number | null; DeathPlaceId?: number | null };
}

interface HeroIdentityEditorProps {
    person: PersonWithRelations;
    onSave: (patch: PersonIdentityPatch) => Promise<void>;
    onDelete: () => void;
    onCancel: () => void;
    saving: boolean;
    /** 'owner'/'edit' only — 'contribute' can write but the server rejects deletes. */
    canDelete: boolean;
}

/**
 * Inline replacement for the hero's name/dateline/badges/buttons block while
 * `editing` is true (PersonDetailView owns that state). Reuses the same
 * Sex/Living-status option labels as the standalone edit form's IdentitySection
 * (no duplicated i18n keys) — see `app/components/person-form/IdentitySection.tsx`.
 * Birth and death dates and places are here as well as on the timeline rows,
 * because they are the fields people most often fix (#795). Entering a death
 * flips the Living control to Deceased, which the user can still override.
 */
export function HeroIdentityEditor({ person, onSave, onDelete, onCancel, saving, canDelete }: HeroIdentityEditorProps) {
    const t = useTranslations('editPerson');
    const tc = useTranslations('common');

    const [firstName, setFirstName] = useState(person.FirstName ?? '');
    const [lastName, setLastName] = useState(person.LastName ?? '');
    const [sex, setSex] = useState<'M' | 'F' | 'X' | ''>(
        person.Sex === 'M' || person.Sex === 'F' || person.Sex === 'X' ? person.Sex : ''
    );
    const [isDeceased, setIsDeceased] = useState<'0' | '1' | ''>(
        person.IsDeceased === 1 ? '1' : person.IsDeceased === 0 ? '0' : ''
    );
    const [nameError, setNameError] = useState(false);
    const [vitals, setVitals] = useState<Record<VitalKey, string>>({
        BirthDate: person.BirthDate ?? '',
        BirthPlace: person.BirthPlace ?? '',
        DeathDate: person.DeathDate ?? '',
        DeathPlace: person.DeathPlace ?? '',
    });
    const [birthResolution, setBirthResolution] = useState<PlaceResolution>(undefined);
    const [deathResolution, setDeathResolution] = useState<PlaceResolution>(undefined);
    const [placeChains, setPlaceChains] = useState<Record<string, PinChainRow[]>>({});
    // The place each field links to (#1186): the saved one, then the one picked.
    const [placeIds, setPlaceIds] = useState<Record<'BirthPlace' | 'DeathPlace', number | null>>({
        BirthPlace: person.BirthPlaceId ?? null,
        DeathPlace: person.DeathPlaceId ?? null,
    });
    const fieldId = useId();
    const { activeTreeId } = useTree();

    // Seed the place fields' pin badges from the saved chains, as the event editor does.
    useEffect(() => {
        // By the place each fact points at: two places may share a name (#1186).
        const keys = uniquePlaceKeys([factPlaceKey(person.BirthPlace, person.BirthPlaceId), factPlaceKey(person.DeathPlace, person.DeathPlaceId)]);
        if (keys.length === 0) return;
        let cancelled = false;
        (async () => {
            try {
                const client = await getDataClient();
                const chains = await client.places.pinChains(keys, activeTreeId);
                if (!cancelled) setPlaceChains(chains);
            } catch {
                // The badge is a hint; the field works without it.
            }
        })();
        return () => { cancelled = true; };
    }, [person.BirthPlace, person.DeathPlace, person.BirthPlaceId, person.DeathPlaceId, activeTreeId]);

    const setVital = (key: VitalKey, value: string) => {
        setVitals((v) => ({ ...v, [key]: value }));
        // Entering a death is what marks someone deceased elsewhere (vitalPatchFor);
        // flip the control here so the change is visible before Save.
        if ((key === 'DeathDate' || key === 'DeathPlace') && value.trim()) setIsDeceased('1');
    };

    const originalSex = person.Sex === 'M' || person.Sex === 'F' || person.Sex === 'X' ? person.Sex : '';
    const originalDeceased = person.IsDeceased === 1 ? '1' : person.IsDeceased === 0 ? '0' : '';
    const dirty = firstName !== (person.FirstName ?? '') || lastName !== (person.LastName ?? '')
        || sex !== originalSex || isDeceased !== originalDeceased
        || (Object.keys(vitals) as VitalKey[]).some((key) => vitals[key] !== (person[key] ?? ''))
        || placeIds.BirthPlace !== (person.BirthPlaceId ?? null) || placeIds.DeathPlace !== (person.DeathPlaceId ?? null);

    const [confirmClearDeath, setConfirmClearDeath] = useState(false);
    const nextDeceased = isDeceased === '1' ? 1 : isDeceased === '0' ? 0 : null;

    const handleSave = (clearDeath = false) => {
        if (!firstName.trim() && !lastName.trim()) {
            setNameError(true);
            return;
        }
        setNameError(false);
        // Only a status the user changed here asks: an imported death with no flag
        // still reads as deceased and is left alone by unrelated edits.
        if (!clearDeath && isDeceased !== originalDeceased && statusDropsDeath(nextDeceased, { DeathDate: vitals.DeathDate, DeathPlace: vitals.DeathPlace, DeathCause: person.DeathCause })) {
            setConfirmClearDeath(true);
            return;
        }
        setConfirmClearDeath(false);
        const changed: PersonIdentityPatch['vitals'] = {};
        for (const key of Object.keys(vitals) as VitalKey[]) {
            const next = vitals[key].trim() || null;
            if (next !== (person[key] ?? null)) changed[key] = next;
        }
        onSave({
            FirstName: firstName,
            LastName: lastName,
            Sex: sex,
            IsDeceased: isDeceased,
            vitals: clearDeath ? { ...changed, DeathDate: null, DeathPlace: null } : changed,
            clearDeath,
            placeResolutions: { BirthPlace: birthResolution, DeathPlace: deathResolution },
            placeIds: {
                ...(vitals.BirthPlace.trim() && placeIds.BirthPlace !== (person.BirthPlaceId ?? null) ? { BirthPlaceId: placeIds.BirthPlace } : {}),
                ...(vitals.DeathPlace.trim() && placeIds.DeathPlace !== (person.DeathPlaceId ?? null) ? { DeathPlaceId: placeIds.DeathPlace } : {}),
            },
        });
    };

    const vitalRow = (dateKey: 'BirthDate' | 'DeathDate', placeKey: 'BirthPlace' | 'DeathPlace', setResolution: (r: PlaceResolution) => void) => (
        <HeroEditorRow>
            <FieldLabel label={t(dateKey === 'BirthDate' ? 'birth_date' : 'death_date')} htmlFor={`${fieldId}-${dateKey}`}>
                <DateInput id={`${fieldId}-${dateKey}`} value={vitals[dateKey]} onChange={(v) => setVital(dateKey, v)} className={fieldClass()} />
            </FieldLabel>
            <FieldLabel label={t(placeKey === 'BirthPlace' ? 'birth_place' : 'death_place')} htmlFor={`${fieldId}-${placeKey}`}>
                <LocationField
                    id={`${fieldId}-${placeKey}`}
                    value={vitals[placeKey]}
                    onChange={(v) => setVital(placeKey, v)}
                    onResolve={setResolution}
                    onRemove={() => setResolution(null)}
                    initialChain={factPlaceEntry(placeChains, vitals[placeKey], placeIds[placeKey]) ?? null}
                    placeId={placeIds[placeKey]}
                    onPlaceIdChange={(id) => setPlaceIds((ids) => (ids[placeKey] === id ? ids : { ...ids, [placeKey]: id }))}
                    treeId={activeTreeId}
                    className={fieldClass()}
                    placeholder={t('place_placeholder')}
                />
            </FieldLabel>
        </HeroEditorRow>
    );

    return (
        <HeroEditorPanel
            onSave={() => handleSave()}
            onCancel={onCancel}
            saving={saving}
            dirty={dirty}
            onDelete={canDelete ? onDelete : undefined}
            deleteLabel={`${t('delete_person')}…`}
        >
            <HeroEditorRow>
                <FieldLabel label={t('first_name')} htmlFor={`${fieldId}-first`}>
                    <Input
                        id={`${fieldId}-first`}
                        value={firstName}
                        onChange={(e) => { setFirstName(e.target.value); setNameError(false); }}
                        placeholder={t('first_name_placeholder')}
                        autoComplete="off"
                        autoFocus
                    />
                </FieldLabel>
                <FieldLabel label={t('last_name')} htmlFor={`${fieldId}-last`}>
                    <Input
                        id={`${fieldId}-last`}
                        value={lastName}
                        onChange={(e) => { setLastName(e.target.value); setNameError(false); }}
                        placeholder={t('last_name_placeholder')}
                        autoComplete="off"
                    />
                </FieldLabel>
            </HeroEditorRow>
            {nameError && (
                <div role="alert" className="text-meta" style={{ color: 'var(--color-error)' }}>
                    {t('err_name_required')}
                </div>
            )}

            <div className="flex gap-3 flex-wrap">
                <FieldLabel label={t('sex')}>
                    <SegmentedControl
                        value={sex}
                        onChange={(v) => setSex(v as 'M' | 'F' | 'X' | '')}
                        aria-label={t('sex')}
                        options={[
                            { v: '', l: tc('unknown') },
                            { v: 'M', l: t('sex_male') },
                            { v: 'F', l: t('sex_female') },
                            { v: 'X', l: t('sex_nonbinary') },
                        ]}
                    />
                </FieldLabel>
                <FieldLabel label={tc('living_status')}>
                    <SegmentedControl
                        value={isDeceased}
                        onChange={(v) => setIsDeceased(v as '0' | '1' | '')}
                        aria-label={tc('living_status')}
                        options={[
                            { v: '', l: tc('unknown') },
                            { v: '0', l: tc('living') },
                            { v: '1', l: tc('deceased') },
                        ]}
                    />
                </FieldLabel>
            </div>

            {vitalRow('BirthDate', 'BirthPlace', setBirthResolution)}
            {vitalRow('DeathDate', 'DeathPlace', setDeathResolution)}
            <ClearDeathConfirm
                status={confirmClearDeath ? (nextDeceased === 0 ? 'living' : 'unknown') : null}
                name={[firstName, lastName].map((n) => n.trim()).filter(Boolean).join(' ')}
                onConfirm={() => handleSave(true)}
                onCancel={() => { setConfirmClearDeath(false); setIsDeceased(originalDeceased); }}
            />
        </HeroEditorPanel>
    );
}
