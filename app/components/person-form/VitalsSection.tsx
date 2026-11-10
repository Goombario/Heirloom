'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import DateInput from '@/app/components/DateInput';
import LocationField from '@/app/components/LocationField';
import { Info } from '@/lib/icons';
import { FormSection, FactGroupLabel, FieldLabel, fieldClass, Input } from '@/app/components/ui';
import type { UsePersonForm } from '@/app/components/person-form/usePersonForm';

/**
 * VitalsSection — birth date/place + death date/place/cause, one cite pin per
 * fact on its group heading (#548).
 * Setting a death date auto-flips living status (handled in the hook's setField).
 *
 * Structural extraction from PersonForm.tsx (Task 4) — behavior-identical.
 */
export default function VitalsSection({ fm, treeId, mobile = false }: { fm: UsePersonForm; treeId: number | null; mobile?: boolean }) {
    const t = useTranslations('editPerson');
    const fieldId = useId();
    const { form, setField, cite, setBirthPlaceResolution, setDeathPlaceResolution, birthPlaceInitialChain, deathPlaceInitialChain, placeIds, setPlaceId } = fm;
    const gridCols = '1fr';

    return (
        <FormSection title={t('section_vitals')} mobile={mobile}>
            <FactGroupLabel label={t('section_birth')} cite={cite('Birth', t('section_birth'))} />
            <div className={mobile ? 'gap-[13px]' : 'gap-[14px]'} style={{ display: 'grid', gridTemplateColumns: gridCols }}>
                <FieldLabel label={t('date')} fullLabel={t('birth_date')} htmlFor={`${fieldId}-birth-date`}>
                    <DateInput id={`${fieldId}-birth-date`} value={form.BirthDate} onChange={(v) => setField('BirthDate', v)} className={fieldClass()} />
                </FieldLabel>
                <FieldLabel label={t('place')} fullLabel={t('birth_place')} htmlFor={`${fieldId}-birth-place`}>
                    <LocationField
                        id={`${fieldId}-birth-place`}
                        value={form.BirthPlace}
                        onChange={(v) => setField('BirthPlace', v)}
                        onResolve={setBirthPlaceResolution}
                        onRemove={() => setBirthPlaceResolution(null)}
                        initialChain={birthPlaceInitialChain}
                        placeId={placeIds.birth}
                        onPlaceIdChange={(id) => setPlaceId('birth', id)}
                        treeId={treeId}
                        className={fieldClass()}
                        placeholder={t('place_placeholder')}
                    />
                </FieldLabel>
            </div>

            <div className="mt-[18px] pt-3.5 border-t border-t-[color:var(--border-light)]">
                <FactGroupLabel label={t('section_death')} cite={cite('Death', t('section_death'))} />
                <div className={mobile ? 'gap-[13px]' : 'gap-[14px]'} style={{ display: 'grid', gridTemplateColumns: gridCols }}>
                    <FieldLabel label={t('date')} fullLabel={t('death_date')} htmlFor={`${fieldId}-death-date`}>
                        <DateInput id={`${fieldId}-death-date`} value={form.DeathDate} onChange={(v) => setField('DeathDate', v)} className={fieldClass()} />
                    </FieldLabel>
                    <FieldLabel label={t('place')} fullLabel={t('death_place')} htmlFor={`${fieldId}-death-place`}>
                        <LocationField
                            id={`${fieldId}-death-place`}
                            value={form.DeathPlace}
                            onChange={(v) => setField('DeathPlace', v)}
                            onResolve={setDeathPlaceResolution}
                            onRemove={() => setDeathPlaceResolution(null)}
                            initialChain={deathPlaceInitialChain}
                            placeId={placeIds.death}
                            onPlaceIdChange={(id) => setPlaceId('death', id)}
                            treeId={treeId}
                            className={fieldClass()}
                            placeholder={t('place_placeholder')}
                        />
                    </FieldLabel>
                </div>
                <div className={mobile ? 'mt-[13px]' : 'mt-[14px]'}>
                    <FieldLabel label={t('death_cause')} htmlFor={`${fieldId}-death-cause`}>
                        <Input
                            id={`${fieldId}-death-cause`}
                            value={form.DeathCause}
                            onChange={(e) => setField('DeathCause', e.target.value)}
                        />
                    </FieldLabel>
                </div>
                {mobile && form.DeathDate.trim() !== '' && (
                    <div className="mt-[9px] text-meta gap-1.5 leading-[1.45]" style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'flex-start' }}>
                        <Info size={13} className="mt-px" style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden="true" />
                        <span>{t('auto_deceased_note')}</span>
                    </div>
                )}
            </div>
        </FormSection>
    );
}
