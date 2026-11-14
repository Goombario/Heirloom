'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import PersonAvatar from '@/app/components/PersonAvatar';
import { PersonFinder, fieldClass, cx } from '@/app/components/ui';
import { Plus, X } from '@/lib/icons';
import { initialsFromName } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import { getDataClient } from '@/lib/data';
import type { CaseLead, CasePersonRef, PersonResult } from '@/lib/db/schema';
import type { CaseLeadInput } from '@/lib/data/types';
import { CaseFormFrame } from './CaseFormFrame';

type Who = { kind: 'person'; id: number; name: string; ref?: CasePersonRef | PersonResult } | { kind: 'new'; key: string; name: string };

const yearOrNull = (s: string): number | null => (/^\d{1,4}$/.test(s.trim()) ? Number(s.trim()) : null);

/**
 * New lead, and Edit the lead (#58): what you want to find out, from/to years,
 * and who, from the case's people, someone else in the tree, or a new person. People
 * added here join the case; a new person is made in the tree when the lead saves.
 */
export function LeadDialog({ lead, casePeople, treeId, sheet = false, onSave, onClose }: {
    /** Editing this lead; a new one when absent. */
    lead?: CaseLead;
    casePeople: CasePersonRef[];
    treeId: number | null;
    /** On a phone, a full sheet (#135). */
    sheet?: boolean;
    /** Resolves false when the save failed; the dialog stays open. */
    onSave: (input: CaseLeadInput) => Promise<boolean>;
    onClose: () => void;
}) {
    const t = useTranslations('caseResearch');
    const ids = useId();
    const [question, setQuestion] = useState(lead?.Question ?? '');
    const [from, setFrom] = useState(lead?.FromYear != null ? String(lead.FromYear) : '');
    const [to, setTo] = useState(lead?.ToYear != null ? String(lead.ToYear) : '');
    const initial: Who[] = (lead?.people ?? []).map((p) => ({ kind: 'person', id: p.Id, name: displayFullName(p), ref: p }));
    const [who, setWho] = useState<Who[]>(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fromYear = yearOrNull(from);
    const toYear = yearOrNull(to);
    const badYears = (from.trim() !== '' && fromYear == null) || (to.trim() !== '' && toYear == null) || (fromYear != null && toYear != null && fromYear > toYear);
    const ready = question.trim() !== '' && !badYears && !busy;
    const dirty = question !== (lead?.Question ?? '') || who.length !== initial.length || from !== (lead?.FromYear?.toString() ?? '') || to !== (lead?.ToYear?.toString() ?? '');
    const picked = new Set(who.flatMap((w) => (w.kind === 'person' ? [w.id] : [])));
    const others = who.filter((w) => w.kind === 'new' || !casePeople.some((p) => p.Id === w.id));

    const toggle = (p: CasePersonRef) => setWho((list) => (picked.has(p.Id)
        ? list.filter((w) => !(w.kind === 'person' && w.id === p.Id))
        : [...list, { kind: 'person', id: p.Id, name: displayFullName(p), ref: p }]));

    const save = async () => {
        if (!ready) return;
        setBusy(true);
        setError(null);
        try {
            const personIds: number[] = [];
            for (const w of who) {
                if (w.kind === 'person') { personIds.push(w.id); continue; }
                const words = w.name.trim().split(/\s+/);
                const client = await getDataClient();
                const created = await client.people.create({ FirstName: words[0] ?? null, LastName: words.slice(1).join(' ') || null }, { treeId });
                personIds.push(created.Id);
            }
            const ok = await onSave({ question: question.trim(), fromYear, toYear, personIds });
            if (ok) onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <CaseFormFrame sheet={sheet} title={lead ? t('edit_lead') : t('new_lead')} dirty={dirty} busy={busy} ready={ready}
            saveLabel={lead ? t('save_lead') : t('add_lead')} onSave={save} onClose={onClose}>
            <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                <label className="grid gap-1.5 text-sm text-text-secondary">
                    {t('lead_question')}
                    <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} className={fieldClass()} placeholder={t('lead_question_hint')} />
                </label>
                <fieldset className="m-0 p-0 border-0 grid gap-1.5">
                    <legend className="mb-1.5 text-sm text-text-secondary">{t('lead_years')}</legend>
                    <div className="flex items-center gap-2">
                        <input aria-label={t('from_year')} inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} className={cx(fieldClass(), 'w-28 date-mono')} placeholder={t('from')} aria-describedby={badYears ? `${ids}-years` : undefined} />
                        <span aria-hidden="true" className="text-text-muted">–</span>
                        <input aria-label={t('to_year')} inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} className={cx(fieldClass(), 'w-28 date-mono')} placeholder={t('to')} aria-describedby={badYears ? `${ids}-years` : undefined} />
                    </div>
                    {badYears && <p id={`${ids}-years`} role="alert" className="m-0 text-sm text-error">{t('years_invalid')}</p>}
                </fieldset>
                <fieldset className="m-0 p-0 border-0 grid gap-2">
                    <legend className="mb-1.5 text-sm text-text-secondary">{t('lead_who')}</legend>
                    <div className="flex flex-wrap gap-1.5">
                        {casePeople.map((p) => {
                            const on = picked.has(p.Id);
                            const name = displayFullName(p) || t('unnamed');
                            return (
                                <button key={p.Id} type="button" aria-pressed={on} onClick={() => toggle(p)}
                                    className={cx('inline-flex items-center gap-1.5 h-[30px] rounded-full pl-1 pr-3 text-sm cursor-pointer focus-ring border',
                                        on ? 'bg-segment-on text-on-segment border-segment-on' : 'bg-card text-text border-dashed border-border')}>
                                    <PersonAvatar as="span" size={22} treeId={treeId} mediaId={p.PrimaryMediaId} focalX={p.FocalX} focalY={p.FocalY} focalRadius={p.FocalRadius}
                                        sex={p.Sex} name={name} initials={initialsFromName(name)} />
                                    {name}
                                </button>
                            );
                        })}
                        {others.map((w) => (
                            <span key={w.kind === 'new' ? w.key : w.id} className="inline-flex items-center gap-1 h-[30px] rounded-full bg-segment-on pl-3 pr-1 text-sm text-on-segment">
                                {w.kind === 'new' ? t('new_person_named', { name: w.name }) : w.name}
                                <button type="button" aria-label={t('remove_person', { name: w.name })} onClick={() => setWho((list) => list.filter((x) => x !== w))}
                                    className="grid place-items-center w-6 h-6 rounded-full bg-transparent border-0 text-on-segment cursor-pointer focus-ring">
                                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                            </span>
                        ))}
                    </div>
                    <PersonFinder
                        title={t('someone_else')}
                        treeId={treeId}
                        excludeIds={[...picked]}
                        onPick={(p) => setWho((list) => [...list, { kind: 'person', id: p.Id, name: displayFullName(p), ref: p }])}
                        onCreate={(name) => setWho((list) => [...list, { kind: 'new', key: `${name}-${list.length}`, name: name.trim() }])}
                        trigger={(p) => (
                            <button {...p} type="button" className="justify-self-start inline-flex items-center gap-1 bg-transparent border-0 p-0 text-sm text-link hover:underline cursor-pointer focus-ring rounded-sm">
                                <Plus className="w-3.5 h-3.5" aria-hidden="true" />{t('someone_else')}
                            </button>
                        )}
                    />
                    <p className="m-0 text-meta text-text-muted">{t('lead_people_join')}</p>
                </fieldset>
                {error && <p role="alert" className="m-0 text-sm text-error">{error}</p>}
            </form>
        </CaseFormFrame>
    );
}
