'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AddRow, Banner, Button, IconButton, Input, SectionHeader, cx } from '@/app/components/ui';
import { Plus, Trash2 } from '@/lib/icons';
import type { PlaceOtherName, PlaceOtherNameDraft } from '@/lib/data/types';
import { placeHref } from '@/lib/places/place-key';
import { checkOtherName, sortOtherNames, sameName, type OtherNameProblem, type PlaceNameIndex } from '@/lib/places/other-names';

/*
 * A place's other names on the place page (#1185, mockup locked 2026-10-25): the
 * rail card that lists them, the edit form's Other names group, the messages their
 * checks give, and the rename choices (keep the old name, merge or keep apart).
 * The phone page reuses the formatting, the checks and the rename choices.
 */

/** Languages the Language field suggests; any text is allowed. */
const LANGUAGES = ['German', 'Polish', 'Ukrainian', 'Russian', 'Latin', 'Yiddish', 'Hungarian', 'English', 'French'];
export const LANGUAGE_LIST_ID = 'place-name-languages';

/** The language suggestions, once per page. */
export function LanguageOptions() {
    return <datalist id={LANGUAGE_LIST_ID}>{LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist>;
}

/** "German · until 1918": a name's language and the years it was used, or ''. */
export function useOtherNameMeta() {
    const t = useTranslations('places');
    return useCallback((n: Pick<PlaceOtherName, 'language' | 'fromDate' | 'toDate'>) => {
        const span = n.fromDate && n.toDate ? t('other_name_span', { from: n.fromDate, to: n.toDate })
            : n.toDate ? t('other_name_until', { date: n.toDate })
            : n.fromDate ? t('other_name_from', { date: n.fromDate })
            : '';
        return [n.language ?? '', span].filter(Boolean).join(' · ');
    }, [t]);
}

/** The header line under the place's name: its other names, in italics. */
export function OtherNamesSubtitle({ names, className }: { names: PlaceOtherName[] | undefined; className?: string }) {
    if (!names?.length) return null;
    return <p className={cx('m-0 serif italic', className)}>{sortOtherNames(names).map((n) => n.name).join(' · ')}</p>;
}

/**
 * Desktop rail: each name with its language, dates and records. Editors get the
 * trailing "+ Add a name" row the place page's other cards end with (#1215).
 */
export function OtherNamesCard({ names, canEdit, onAdd }: { names: PlaceOtherName[]; canEdit: boolean; onAdd: () => void }) {
    const t = useTranslations('places');
    const meta = useOtherNameMeta();
    if (names.length === 0 && !canEdit) return null;
    return (
        <div className="card" data-testid="other-names-card">
            <div className={cx('px-4 pt-4', names.length === 0 && 'pb-1')}>
                <SectionHeader level="rail" title={<>{t('other_names')}{names.length > 0 && <span className="ml-1.5 font-mono font-normal text-xs text-text-muted">{names.length}</span>}</>} />
            </div>
            {names.length > 0 && (
                <ul className={cx('m-0 px-4 list-none', !canEdit && 'pb-2')}>
                    {sortOtherNames(names).map((n) => (
                        <li key={n.id} className="grid grid-cols-[1fr_auto] gap-x-3 py-2 border-b border-border-light last:border-0">
                            <span className="serif text-base text-text min-w-0 break-words">{n.name}</span>
                            <span className="row-span-2 self-center text-right tabular-nums text-sm text-text-secondary">
                                {n.records || '—'}
                                <small className="block text-xs text-text-muted">{t('other_name_records', { count: n.records })}</small>
                            </span>
                            <span className="text-xs text-text-muted">{meta(n) || t('other_name_no_meta')}</span>
                        </li>
                    ))}
                </ul>
            )}
            {canEdit && <AddRow label={t('add_a_name')} onClick={onAdd} className="rounded-b-card border-t border-border-light" />}
        </div>
    );
}

/** One name in the editor: the saved row it came from (if any) and its fields as typed. */
export interface NameDraft {
    key: string;
    id: number | null;
    name: string;
    language: string;
    fromDate: string;
    toDate: string;
    /** The name as saved, or null for a new one. */
    saved: string | null;
    /** Records written under the saved name. */
    records: number;
    /** Marked for removal on Save. */
    gone: boolean;
}

let draftSeq = 0;
export const blankDraft = (): NameDraft => ({ key: `new-${++draftSeq}`, id: null, name: '', language: '', fromDate: '', toDate: '', saved: null, records: 0, gone: false });

export const draftsFor = (names: PlaceOtherName[] | undefined): NameDraft[] => sortOtherNames(names ?? []).map((n) => ({
    key: `name-${n.id}`, id: n.id, name: n.name, language: n.language ?? '', fromDate: n.fromDate ?? '', toDate: n.toDate ?? '',
    saved: n.name, records: n.records, gone: false,
}));

/** The list Save sends: every name kept, and every new one typed. */
export function draftsToSave(drafts: readonly NameDraft[]): PlaceOtherNameDraft[] {
    return drafts.filter((d) => !d.gone && (d.id != null || d.name.trim() !== '')).map((d) => ({
        id: d.id, name: d.name.trim(), language: d.language.trim() || null, fromDate: d.fromDate.trim() || null, toDate: d.toDate.trim() || null,
    }));
}

/** Whether the drafts differ from the saved names. */
export function draftsChanged(drafts: readonly NameDraft[], names: PlaceOtherName[] | undefined): boolean {
    const now = draftsToSave(drafts);
    const saved = names ?? [];
    if (now.length !== saved.length) return true;
    return now.some((d) => {
        const s = saved.find((n) => n.id === d.id);
        return !s || s.name !== d.name || s.language !== d.language || s.fromDate !== d.fromDate || s.toDate !== d.toDate;
    });
}

/** A name the user typed or changed whose spelling records don't have: its check result. */
function draftProblem(d: NameDraft, drafts: readonly NameDraft[], placeName: string, index: PlaceNameIndex | null): OtherNameProblem | null {
    if (d.gone) return null;
    if (d.id != null && d.name.trim() === '') return { kind: 'blank' };
    if (d.saved != null && d.saved === d.name.trim()) return null;
    return checkOtherName(d.name, placeName, drafts.filter((o) => o !== d && !o.gone).map((o) => o.name), index);
}

/** Save stays off while any name fails its check (an info one included). */
export const draftsBlocked = (drafts: readonly NameDraft[], placeName: string, index: PlaceNameIndex | null) =>
    drafts.some((d) => draftProblem(d, drafts, placeName, index) != null);

/** A renamed spelling whose records keep the old one (not a case fix). */
const respelt = (d: NameDraft) => d.saved != null && d.name.trim() !== '' && !sameName(d.saved, d.name);

/** What a failed check says, with the merge link for a name that is its own place. */
function OtherNameProblemText({ problem, placeName }: { problem: OtherNameProblem; placeName: string }) {
    const t = useTranslations('places');
    switch (problem.kind) {
        case 'blank': return <>{t('check_blank')}</>;
        case 'own': return <>{t('check_own')}</>;
        case 'repeat': return <>{t('check_repeat', { place: placeName, name: problem.name })}</>;
        case 'taken': return <>{t('check_taken', { name: problem.name, place: problem.place })}</>;
        case 'empty_place': return <>{t('check_empty_place', { name: problem.name, place: placeName })}</>;
        case 'merge': return (
            <>
                {t.rich('check_merge', { name: problem.name, place: placeName, count: problem.records, b: (c) => <b>{c}</b> })}{' '}
                <Link href={mergeIntoHref(problem.id, placeName)} className="font-semibold underline underline-offset-2 focus-ring">
                    {t('check_merge_link', { name: problem.name, place: placeName })}
                </Link>
            </>
        );
    }
}

/** The other place's page, opening its Rename or merge with `into` typed and the old name kept. */
const mergeIntoHref = (placeId: number, into: string) =>
    `${placeHref({ id: placeId, name: '' })}&rename=${encodeURIComponent(into)}&keep=1`;

/** A check's message in its box: info for "merge it in instead", error otherwise. */
export function OtherNameProblemBanner({ problem, placeName, className }: { problem: OtherNameProblem; placeName: string; className?: string }) {
    return (
        <Banner tone={problem.kind === 'merge' ? 'info' : 'error'} className={cx('!px-3 !py-2 !text-xs', className)}>
            <OtherNameProblemText problem={problem} placeName={placeName} />
        </Banner>
    );
}

/** Desktop edit form: one block per name, then "Add another name". */
export function OtherNamesEditor({ drafts, onChange, placeName, index, disabled }: {
    drafts: NameDraft[];
    onChange: (drafts: NameDraft[]) => void;
    placeName: string;
    index: PlaceNameIndex | null;
    disabled?: boolean;
}) {
    const t = useTranslations('places');
    const set = (key: string, patch: Partial<NameDraft>) => onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    // A name added with the button takes the cursor; the one the form opens with doesn't.
    const [added, setAdded] = useState<string | null>(null);
    const add = () => {
        const next = blankDraft();
        setAdded(next.key);
        onChange([...drafts, next]);
    };
    return (
        <div className="grid gap-2.5" data-testid="other-names-editor">
            {drafts.map((d) => {
                if (d.gone) {
                    return (
                        <div key={d.key} className="grid gap-2 rounded-lg border border-border-light p-3">
                            <div className="flex items-center justify-between gap-2">
                                <s className="serif text-base text-text-muted break-words min-w-0">{d.saved}</s>
                                <button type="button" onClick={() => set(d.key, { gone: false })} disabled={disabled}
                                    className="shrink-0 text-sm text-link hover:underline cursor-pointer focus-ring">
                                    {t('other_name_keep')}
                                </button>
                            </div>
                            {d.records > 0 ? (
                                <Banner tone="warning" role="status" className="!px-3 !py-2 !text-xs">
                                    {t('other_name_removed_used', { count: d.records, name: d.saved ?? '' })}
                                </Banner>
                            ) : (
                                <p className="m-0 text-xs text-text-muted">{t('other_name_removed_unused')}</p>
                            )}
                        </div>
                    );
                }
                const problem = draftProblem(d, drafts, placeName, index);
                const label = d.name.trim() || d.saved || '';
                return (
                    <div key={d.key} className={cx('grid gap-2 rounded-lg border p-3', d.id == null ? 'border-dashed border-border' : 'border-border-light')}>
                        <div className="flex items-end gap-2">
                            <Input size="sm" label={t('other_name_field')} value={d.name} placeholder={t('other_name_placeholder')} autoFocus={d.key === added}
                                onChange={(e) => set(d.key, { name: e.target.value })} disabled={disabled} maxLength={500} autoComplete="off"
                                aria-invalid={problem && problem.kind !== 'merge' ? true : undefined}
                                wrapClassName="flex-1 min-w-0" className="serif" />
                            <IconButton label={label ? t('other_name_remove', { name: label }) : t('other_name_remove_blank')}
                                icon={<Trash2 size={16} aria-hidden="true" />} className="w-8 h-8" disabled={disabled}
                                onClick={() => (d.id == null ? onChange(drafts.filter((o) => o.key !== d.key)) : set(d.key, { gone: true }))} />
                        </div>
                        <div className="grid grid-cols-[minmax(0,1fr)_76px_76px] gap-2">
                            <Input size="sm" label={t('other_name_language')} value={d.language} list={LANGUAGE_LIST_ID} placeholder={t('other_name_optional')}
                                onChange={(e) => set(d.key, { language: e.target.value })} disabled={disabled} maxLength={100} autoComplete="off" />
                            <Input size="sm" label={t('other_name_from_label')} value={d.fromDate} placeholder={t('other_name_year')}
                                onChange={(e) => set(d.key, { fromDate: e.target.value })} disabled={disabled} maxLength={100} autoComplete="off" />
                            <Input size="sm" label={t('other_name_until_label')} value={d.toDate} placeholder={t('other_name_year')}
                                onChange={(e) => set(d.key, { toDate: e.target.value })} disabled={disabled} maxLength={100} autoComplete="off" />
                        </div>
                        {problem ? <OtherNameProblemBanner problem={problem} placeName={placeName} />
                            : respelt(d) && d.records > 0 ? (
                                <Banner tone="warning" role="status" className="!px-3 !py-2 !text-xs">
                                    {t('other_name_respelt_used', { count: d.records, name: d.saved ?? '' })}
                                </Banner>
                            )
                            : d.records > 0 ? <p className="m-0 text-xs text-text-muted">{t('other_name_used', { count: d.records, name: d.saved ?? '' })}</p>
                            : null}
                    </div>
                );
            })}
            <div>
                <Button variant="outline" size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={add} disabled={disabled}>
                    {t('add_another_name')}
                </Button>
            </div>
            <LanguageOptions />
        </div>
    );
}

/** How a rename treats the old name and a place that already has the new one. */
export interface RenameChoice {
    keepOld: boolean;
    separate: boolean;
}

/**
 * Under the place name, once it is changed: "Merge X into Y" or "Keep them as
 * separate places" when Y is already a place, then "Keep “X” as another name".
 * `records` are the place's records that say its own name.
 */
export function RenameChoices({ from, to, target, records, choice, onChoice, disabled }: {
    from: string;
    to: string;
    /** The place already called `to`, if any. */
    target: string | null;
    records: number;
    choice: RenameChoice;
    onChoice: (choice: RenameChoice) => void;
    disabled?: boolean;
}) {
    const t = useTranslations('places');
    const name = `rename-mode-${from}`;
    return (
        <div className="grid gap-2.5 mt-2.5">
            {target && (
                <fieldset className="grid gap-0 min-w-0 rounded-lg border border-border">
                    <legend className="sr-only">{t('already_a_place', { name: target })}</legend>
                    <p aria-hidden="true" className="m-0 px-3 pt-2.5 pb-1 text-xs font-semibold text-text-secondary">{t('already_a_place', { name: target })}</p>
                    {([
                        [false, t('merge_choice', { from, to: target }), t('merge_choice_hint', { from, to: target })],
                        [true, t('separate_choice'), t('separate_choice_hint', { name: target })],
                    ] as const).map(([separate, label, hint]) => (
                        <label key={String(separate)} className="flex items-start gap-2.5 px-3 py-2 cursor-pointer border-t border-border-light first-of-type:border-t-0">
                            <input type="radio" name={name} checked={choice.separate === separate} disabled={disabled}
                                onChange={() => onChoice({ ...choice, separate })} className="mt-1 accent-[color:var(--color-primary)]" />
                            <span className="grid min-w-0">
                                <span className="text-sm font-medium text-text">{label}</span>
                                <span className="text-xs text-text-muted">{hint}</span>
                            </span>
                        </label>
                    ))}
                </fieldset>
            )}
            <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={choice.keepOld} disabled={disabled}
                    onChange={(e) => onChoice({ ...choice, keepOld: e.target.checked })} className="mt-0.5 w-4 h-4 m-0 accent-primary" />
                <span className="grid min-w-0">
                    <span className="text-sm font-medium text-text">{t('keep_old_name', { name: from })}</span>
                    <span className="text-xs text-text-muted">
                        {choice.keepOld ? t('keep_old_hint_kept', { count: records, name: from }) : t('keep_old_hint_moved', { count: records, name: from, to: target && !choice.separate ? target : to })}
                    </span>
                </span>
            </label>
        </div>
    );
}
