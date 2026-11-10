'use client';

import React, { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PersonWithRelations } from '@/lib/db/schema';
import { getDataClient } from '@/lib/data';
import { useErrorToast } from '@/app/components/useErrorToast';
import { MobileRow, SegmentedControl, cx, fieldClass, showChangeToast } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { Trash2 } from '@/lib/icons';
import { nameBarParts } from './model';
import type { RunChange } from './useChange';

/*
 * Edit person on the phone (#1053, tracking #1054): the birth name and sex, and Delete
 * person for editors. Birth, death and living status stay in the vitals strip (#1047),
 * and other names in Names & aliases. Full height with Save in the header, like every
 * typing sheet.
 */

const SEXES = ['', 'M', 'F', 'X'] as const;
type Sex = (typeof SEXES)[number];

const asSex = (v: string | null | undefined): Sex => (SEXES as readonly string[]).includes(v ?? '') ? (v ?? '') as Sex : '';

export function EditPersonSheet(props: {
    open: boolean; onClose: () => void; person: PersonWithRelations; treeId: number | null;
    canDelete: boolean; run: RunChange;
    /** The person is gone: leave their page. */
    onDeleted: () => void;
}) {
    // A fresh draft each time it opens.
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(props.open);
    if (props.open !== wasOpen) { setWasOpen(props.open); if (props.open) setOpened((n) => n + 1); }
    return <EditPersonBody key={opened} {...props} />;
}

function EditPersonBody({ open, onClose, person, treeId, canDelete, run, onDeleted }: Parameters<typeof EditPersonSheet>[0]) {
    const t = useTranslations('mobileProfile');
    const { reportError } = useErrorToast();
    const ids = useId();
    const saved = { first: person.FirstName ?? '', last: person.LastName ?? '', sex: asSex(person.Sex) };
    const [draft, setDraft] = useState(saved);
    const [saving, setSaving] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const dirty = draft.first.trim() !== saved.first.trim() || draft.last.trim() !== saved.last.trim() || draft.sex !== saved.sex;
    const name = `${draft.first} ${draft.last}`.trim();
    const shownName = nameBarParts(person).given || `${saved.first} ${saved.last}`.trim() || t('this_person');

    const save = async () => {
        if (saving) return;
        setSaving(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            return client.people.update(person.Id, {
                FirstName: draft.first.trim() || null,
                LastName: draft.last.trim() || null,
                Sex: draft.sex || null,
            }, treeId);
        }, { message: t('person_saved'), detail: name || undefined });
        setSaving(false);
        if (ok) onClose();
    };

    // Deleting is audited but returns no ids to undo with, so the way back is History.
    const remove = async () => {
        setSaving(true);
        try {
            const client = await getDataClient();
            await client.people.remove(person.Id, treeId);
        } catch (e) {
            setSaving(false);
            setConfirming(false);
            reportError(e);
            return;
        }
        showChangeToast({ message: t('person_deleted', { name: `${saved.first} ${saved.last}`.trim() || t('this_person') }) });
        onDeleted();
    };

    const field = (key: 'first' | 'last', label: string, placeholder: string, last: boolean) => (
        <div className="grid gap-1.5">
            <label htmlFor={`${ids}-${key}`} className="text-meta font-medium text-text-secondary">{label}</label>
            <input id={`${ids}-${key}`} type="text" value={draft[key]} maxLength={200} autoComplete="off"
                autoCapitalize="words" enterKeyHint={last ? 'done' : 'next'} placeholder={placeholder}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                className={cx(fieldClass(), 'min-h-11')} />
        </div>
    );

    return (
        <Sheet open={open} onClose={onClose} title={t('edit_person')} size="full" dirty={dirty} onSave={save} saveDisabled={saving}>
            <div className="grid gap-3 pb-4">
                <h3 className="eyebrow m-0">{t('group_name')}</h3>
                {field('first', t('first_name'), t('first_name_placeholder'), false)}
                {field('last', t('last_name'), t('last_name_placeholder'), true)}
            </div>
            <div className="grid gap-3 pt-4 pb-3 border-t border-border">
                <h3 className="eyebrow m-0">{t('group_about')}</h3>
                <div className="grid gap-1.5">
                    <span aria-hidden="true" className="text-meta font-medium text-text-secondary">{t('field_sex')}</span>
                    <SegmentedControl
                        fullWidth
                        aria-label={t('field_sex')}
                        value={draft.sex}
                        onChange={(v) => setDraft((d) => ({ ...d, sex: asSex(v) }))}
                        options={[
                            { v: '', l: t('sex_unknown') }, { v: 'M', l: t('sex_male') },
                            { v: 'F', l: t('sex_female') }, { v: 'X', l: t('sex_nonbinary') },
                        ]}
                    />
                </div>
                <p className="m-0 text-sm text-text-muted">{t('vitals_elsewhere')}</p>
            </div>
            {canDelete && (
                <>
                    <div className="-mx-4 border-t border-border mt-2">
                        <MobileRow icon={<Trash2 />} tone="danger" label={t('delete_person')} sub={t('delete_person_sub')} onClick={() => setConfirming(true)} />
                    </div>
                    <ConfirmSheet open={confirming} title={t('delete_person_title', { name: shownName })} body={t('delete_person_body')}
                        confirmLabel={t('delete_person')} onConfirm={remove} onClose={() => setConfirming(false)} busy={saving} />
                </>
            )}
        </Sheet>
    );
}
