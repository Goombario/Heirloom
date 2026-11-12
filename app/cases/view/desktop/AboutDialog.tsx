'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, FormDialog, PersonFinder, fieldClass, cx } from '@/app/components/ui';
import { Plus, X } from '@/lib/icons';
import { displayFullName } from '@/lib/utils/names';
import type { CaseWithRelations } from '@/lib/db/schema';
import type { UpdateCaseInput } from '@/lib/data/types';

const yearOrNull = (s: string): number | null => (/^\d{1,4}$/.test(s.trim()) ? Number(s.trim()) : null);

/**
 * Edit the question (#58): its wording, people, years and focus place. The About
 * this case pencil and the case ⋯ menu both open it.
 */
export function AboutDialog({ caseData, treeId, onSave, onClose }: {
    caseData: CaseWithRelations;
    treeId: number | null;
    onSave: (patch: UpdateCaseInput) => Promise<boolean>;
    onClose: () => void;
}) {
    const t = useTranslations('caseResearch');
    const tc = useTranslations('common');
    const [title, setTitle] = useState(caseData.Title);
    const [from, setFrom] = useState(caseData.FromYear != null ? String(caseData.FromYear) : '');
    const [to, setTo] = useState(caseData.ToYear != null ? String(caseData.ToYear) : '');
    const [place, setPlace] = useState(caseData.Place ?? '');
    const [background, setBackground] = useState(caseData.Description ?? '');
    const initialTags = (caseData.Tags ?? []).join(', ');
    const [tags, setTags] = useState(initialTags);
    const [people, setPeople] = useState(caseData.people.map((p) => ({ id: p.Id, name: displayFullName(p) || t('unnamed') })));
    const [busy, setBusy] = useState(false);

    const fromYear = yearOrNull(from);
    const toYear = yearOrNull(to);
    const badYears = (from.trim() !== '' && fromYear == null) || (to.trim() !== '' && toYear == null) || (fromYear != null && toYear != null && fromYear > toYear);
    const ready = title.trim() !== '' && !badYears && !busy;
    const dirty = title !== caseData.Title || place !== (caseData.Place ?? '') || from !== (caseData.FromYear?.toString() ?? '')
        || to !== (caseData.ToYear?.toString() ?? '') || people.length !== caseData.people.length
        || background !== (caseData.Description ?? '') || tags !== initialTags;

    const save = async () => {
        if (!ready) return;
        setBusy(true);
        const ok = await onSave({
            Title: title.trim(), FromYear: fromYear, ToYear: toYear, Place: place.trim() || null,
            Description: background.trim() || null,
            Tags: [...new Set(tags.split(',').map((tag) => tag.trim()).filter(Boolean))],
            personIds: people.map((p) => p.id),
        });
        setBusy(false);
        if (ok) onClose();
    };

    return (
        <FormDialog
            open
            onClose={onClose}
            title={t('edit_question')}
            dirty={dirty}
            busy={busy}
            footer={(requestClose) => (
                <>
                    <Button variant="outline" onClick={requestClose} disabled={busy}>{tc('cancel')}</Button>
                    <Button onClick={() => { void save(); }} disabled={!ready}>{tc('save')}</Button>
                </>
            )}
        >
            <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                <label className="grid gap-1.5 text-sm text-text-secondary">
                    {t('question')}
                    <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} className={fieldClass()} />
                </label>
                <fieldset className="m-0 p-0 border-0 grid gap-2">
                    <legend className="mb-1.5 text-sm text-text-secondary">{t('people')}</legend>
                    <div className="flex flex-wrap gap-1.5">
                        {people.map((p) => (
                            <span key={p.id} className="inline-flex items-center gap-1 h-[30px] rounded-full bg-surface-2 pl-3 pr-1 text-sm text-text">
                                {p.name}
                                <button type="button" aria-label={t('remove_person', { name: p.name })} onClick={() => setPeople((list) => list.filter((x) => x.id !== p.id))}
                                    className="grid place-items-center w-6 h-6 rounded-full bg-transparent border-0 text-text-muted hover:text-text cursor-pointer focus-ring">
                                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                            </span>
                        ))}
                    </div>
                    <PersonFinder
                        title={t('add_person')}
                        treeId={treeId}
                        excludeIds={people.map((p) => p.id)}
                        onPick={(p) => setPeople((list) => [...list, { id: p.Id, name: displayFullName(p) || t('unnamed') }])}
                        trigger={(p) => (
                            <button {...p} type="button" className="justify-self-start inline-flex items-center gap-1 bg-transparent border-0 p-0 text-sm text-link hover:underline cursor-pointer focus-ring rounded-sm">
                                <Plus className="w-3.5 h-3.5" aria-hidden="true" />{t('add_person')}
                            </button>
                        )}
                    />
                </fieldset>
                <div className="flex flex-wrap gap-4">
                    <fieldset className="m-0 p-0 border-0 grid gap-1.5">
                        <legend className="mb-1.5 text-sm text-text-secondary">{t('years')}</legend>
                        <div className="flex items-center gap-2">
                            <input aria-label={t('from_year')} inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} className={cx(fieldClass('md', 'w-28'), 'date-mono')} placeholder={t('from')} />
                            <span aria-hidden="true" className="text-text-muted">–</span>
                            <input aria-label={t('to_year')} inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} className={cx(fieldClass('md', 'w-28'), 'date-mono')} placeholder={t('to')} />
                        </div>
                    </fieldset>
                    <label className="grid gap-1.5 text-sm text-text-secondary flex-1 min-w-48">
                        {t('focus_place')}
                        <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={500} className={fieldClass()} />
                    </label>
                </div>
                {badYears && <p role="alert" className="m-0 text-sm text-error">{t('years_invalid')}</p>}
                <label className="grid gap-1.5 text-sm text-text-secondary">
                    {t('background')}
                    <textarea rows={3} value={background} onChange={(e) => setBackground(e.target.value)} className={cx(fieldClass(), 'resize-y')} placeholder={t('background_hint')} />
                </label>
                <label className="grid gap-1.5 text-sm text-text-secondary">
                    {t('tags')}
                    <input value={tags} onChange={(e) => setTags(e.target.value)} className={fieldClass()} aria-describedby="about-tags-hint" />
                    <span id="about-tags-hint" className="text-meta text-text-muted">{t('tags_hint')}</span>
                </label>
            </form>
        </FormDialog>
    );
}
