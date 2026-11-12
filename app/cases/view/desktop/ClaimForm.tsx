'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, SegmentedControl, SelectField, cx, fieldClass } from '@/app/components/ui';
import { displayFullName } from '@/lib/utils/names';
import type { CaseClaimEvidence, CasePersonRef } from '@/lib/db/schema';
import type { CaseClaimInput } from '@/lib/data/types';
import { CLAIM_KEYS } from './claims';

const OTHER = 'other';
const SOMEONE = 'someone';

/**
 * Add a claim (#58): what the record says, about whom, its date and place, and
 * the kind of evidence it is. Opens inline under "What the record says".
 */
export function ClaimForm({ people, onAdd, onCancel }: {
    /** The people a claim can be about: the lead's, then the rest of the case's. */
    people: CasePersonRef[];
    onAdd: (claim: CaseClaimInput) => void;
    onCancel: () => void;
}) {
    const t = useTranslations('caseResearch');
    const id = useId();
    const [what, setWhat] = useState<string>(CLAIM_KEYS[0]);
    const [ownWhat, setOwnWhat] = useState('');
    const [who, setWho] = useState<string>(people[0] ? String(people[0].Id) : SOMEONE);
    const [name, setName] = useState('');
    const [says, setSays] = useState('');
    const [date, setDate] = useState('');
    const [place, setPlace] = useState('');
    const [evidence, setEvidence] = useState<CaseClaimEvidence>('direct');

    const whatValue = what === OTHER ? ownWhat.trim() : what;
    const ready = whatValue !== '' && (says.trim() !== '' || date.trim() !== '' || place.trim() !== '');

    const add = () => {
        if (!ready) return;
        const person = who === SOMEONE ? null : Number(who);
        onAdd({
            what: whatValue,
            personId: person,
            personName: person == null ? (name.trim() || null) : null,
            says: says.trim() || null, date: date.trim() || null, place: place.trim() || null,
            evidence,
        });
    };

    return (
        <fieldset className={cx('rounded-card', 'm-0 grid gap-3 border border-border bg-card-alt p-3')}>
            <legend className="sr-only">{t('add_claim')}</legend>
            <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1 text-meta text-text-secondary">
                    <label htmlFor={`${id}-what`}>{t('claim_what')}</label>
                    <SelectField id={`${id}-what`} size="sm" value={what} onChange={setWhat}
                        options={[...CLAIM_KEYS.map((k) => ({ value: k, label: t(`what_${k}`) })), { value: OTHER, label: t('claim_other') }]} />
                </div>
                <div className="grid gap-1 text-meta text-text-secondary">
                    <label htmlFor={`${id}-who`}>{t('claim_about')}</label>
                    <SelectField id={`${id}-who`} size="sm" value={who} onChange={setWho}
                        options={[...people.map((p) => ({ value: String(p.Id), label: displayFullName(p) || t('unnamed') })), { value: SOMEONE, label: t('claim_someone') }]} />
                </div>
            </div>
            {what === OTHER && (
                <label className="grid gap-1 text-meta text-text-secondary">
                    {t('claim_own_what')}
                    <input value={ownWhat} onChange={(e) => setOwnWhat(e.target.value)} maxLength={200} className={fieldClass('sm')} />
                </label>
            )}
            {who === SOMEONE && (
                <label className="grid gap-1 text-meta text-text-secondary">
                    {t('claim_name')}
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={fieldClass('sm')} />
                </label>
            )}
            <label className="grid gap-1 text-meta text-text-secondary">
                {t('claim_says')}
                <input value={says} onChange={(e) => setSays(e.target.value)} maxLength={1000} className={fieldClass('sm')} />
            </label>
            <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-meta text-text-secondary">
                    {t('claim_date')}
                    <input value={date} onChange={(e) => setDate(e.target.value)} maxLength={100} className={cx(fieldClass('sm'), 'date-mono')} />
                </label>
                <label className="grid gap-1 text-meta text-text-secondary">
                    {t('place')}
                    <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={500} className={fieldClass('sm')} />
                </label>
            </div>
            <div className="grid gap-1 text-meta text-text-secondary">
                <span id={`${id}-evidence`}>{t('claim_evidence')}</span>
                <SegmentedControl aria-label={t('claim_evidence')} value={evidence} onChange={(v) => setEvidence(v as CaseClaimEvidence)}
                    options={[{ v: 'direct', l: t('evidence_direct') }, { v: 'indirect', l: t('evidence_indirect') }, { v: 'negative', l: t('evidence_negative') }]} />
            </div>
            <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={onCancel}>{t('cancel')}</Button>
                <Button variant="outline" size="sm" onClick={add} disabled={!ready}>{t('add_claim')}</Button>
            </div>
        </fieldset>
    );
}
