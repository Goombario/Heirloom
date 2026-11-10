'use client';

import { useEffect, useId, useState, type InputHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { Banner, Button, MobileRow, fieldClass } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import type { RunChange } from '@/app/people/view/mobile/useChange';
import { getDataClient } from '@/lib/data';
import type { PlaceDetail, PlaceOtherNameDraft } from '@/lib/data/types';
import { buildPlaceNameIndex, checkOtherName, sameName, type PlaceNameIndex } from '@/lib/places/other-names';
import { LANGUAGE_LIST_ID, LanguageOptions, OtherNameProblemBanner } from '../OtherNames';

/*
 * One of a place's other names on the phone (#1185): add one, change one, or remove
 * it. Remove asks inside the sheet, then the change toast offers Undo like every
 * other phone edit. Each save sends the place's whole list, as the desktop form does.
 */

const short = (name: string) => name.split(',')[0]?.trim() || name;

const asDraft = (n: { id: number; name: string; language: string | null; fromDate: string | null; toDate: string | null }): PlaceOtherNameDraft =>
    ({ id: n.id, name: n.name, language: n.language, fromDate: n.fromDate, toDate: n.toDate });

export function OtherNameSheet({ detail, placeName, nameId, treeId, run, onClose }: {
    detail: PlaceDetail;
    placeName: string;
    /** The name to change, or null to add one. */
    nameId: number | null;
    treeId: number | null;
    run: RunChange;
    onClose: () => void;
}) {
    const t = useTranslations('mobilePlaces');
    const tp = useTranslations('places');
    const ids = useId();
    const names = detail.otherNames ?? [];
    const orig = nameId != null ? names.find((n) => n.id === nameId) ?? null : null;
    const [form, setForm] = useState({ name: orig?.name ?? '', language: orig?.language ?? '', fromDate: orig?.fromDate ?? '', toDate: orig?.toDate ?? '' });
    const [index, setIndex] = useState<PlaceNameIndex | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        let live = true;
        getDataClient()
            .then((client) => client.places.list(treeId))
            .then((list) => { if (live) setIndex(buildPlaceNameIndex(list, detail.id ?? null)); })
            .catch(() => { /* the server checks the name on Save */ });
        return () => { live = false; };
    }, [treeId, detail.id]);

    const place = short(placeName);
    const name = form.name.trim();
    const others = names.filter((n) => n.id !== nameId).map((n) => n.name);
    const problem = orig && orig.name === name ? null : checkOtherName(name, placeName, others, index);
    const dirty = orig
        ? name !== orig.name || form.language.trim() !== (orig.language ?? '') || form.fromDate.trim() !== (orig.fromDate ?? '') || form.toDate.trim() !== (orig.toDate ?? '')
        : name !== '';
    const records = orig?.records ?? 0;
    const respelt = orig != null && name !== '' && !sameName(orig.name, name);

    const write = async (list: PlaceOtherNameDraft[], message: string) => {
        if (detail.id == null || saving) return;
        setSaving(true);
        const placeId = detail.id;
        const ok = await run(async () => (await getDataClient()).places.saveOtherNames(placeId, list, treeId), { message });
        setSaving(false);
        if (ok) onClose();
    };
    const save = () => {
        if (!name || problem || !dirty) return;
        const edited: PlaceOtherNameDraft = { id: nameId, name, language: form.language.trim() || null, fromDate: form.fromDate.trim() || null, toDate: form.toDate.trim() || null };
        const list = nameId == null ? [...names.map(asDraft), edited] : names.map((n) => (n.id === nameId ? edited : asDraft(n)));
        void write(list, nameId == null ? t('name_added', { name }) : t('name_saved', { name }));
    };
    const remove = () => {
        if (!orig) return;
        void write(names.filter((n) => n.id !== orig.id).map(asDraft), t('name_removed', { name: orig.name }));
    };

    const field = (key: 'language' | 'fromDate' | 'toDate', label: string, placeholder: string, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
        <label className="grid gap-1.5 min-w-0">
            <span className="text-meta font-semibold text-text-secondary">{label}</span>
            <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder} autoComplete="off" maxLength={100}
                className={`${fieldClass()} !h-[46px] !rounded-[10px] !text-md`} {...extra} />
        </label>
    );

    return (
        <Sheet open onClose={onClose} title={orig ? orig.name : tp('add_another_name')} size="full" dirty={dirty} onSave={save}
            saveDisabled={saving || !name || !!problem}>
            <div className="grid gap-4 pt-1">
                <div className="grid gap-1.5">
                    <label htmlFor={`${ids}-name`} className="text-meta font-semibold text-text-secondary">{tp('other_name_field')}</label>
                    <input id={`${ids}-name`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" maxLength={500}
                        placeholder={tp('other_name_placeholder')} aria-invalid={problem && problem.kind !== 'merge' ? true : undefined}
                        className={`${fieldClass()} !h-[46px] !rounded-[10px] serif !text-lg`} />
                    {problem ? <OtherNameProblemBanner problem={problem} placeName={placeName} className="mt-1" />
                        : respelt && records > 0 ? (
                            <Banner tone="warning" role="status" className="mt-1 !px-3 !py-2 !text-sm">
                                {tp('other_name_respelt_used', { count: records, name: orig.name })}
                            </Banner>
                        ) : null}
                </div>
                {field('language', tp('other_name_language'), tp('other_name_optional'), { list: LANGUAGE_LIST_ID })}
                <div className="grid grid-cols-2 gap-3">
                    {field('fromDate', tp('other_name_from_label'), tp('other_name_year'))}
                    {field('toDate', tp('other_name_until_label'), tp('other_name_year'))}
                </div>
                <p className="m-0 text-meta leading-snug text-text-muted">{t('name_dates_hint')}</p>
                {orig && records > 0 && !respelt && (
                    <p className="m-0 text-meta leading-snug text-text-muted">{t('name_count_hint', { count: records, name: orig.name, place })}</p>
                )}
                <LanguageOptions />
            </div>
            {orig && (confirming ? (
                <div className="grid gap-3 mt-5">
                    <Banner tone="warning" role="status" className="!text-sm">
                        {records > 0 ? t('remove_name_used', { count: records, name: orig.name }) : t('remove_name_unused', { name: orig.name })}
                    </Banner>
                    <div className="grid grid-cols-2 gap-2.5">
                        <Button variant="outline" size="lg" onClick={() => setConfirming(false)} disabled={saving}>{tp('other_name_keep')}</Button>
                        <Button variant="danger" size="lg" onClick={remove} disabled={saving}>{t('remove_name_confirm')}</Button>
                    </div>
                </div>
            ) : (
                <div className="-mx-4 mt-5 border-t border-border">
                    <MobileRow tone="danger" label={t('remove_name')} onClick={() => setConfirming(true)} disabled={saving} />
                </div>
            ))}
        </Sheet>
    );
}
