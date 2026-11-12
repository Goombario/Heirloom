'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, SegmentedControl, cx, fieldClass } from '@/app/components/ui';
import { getDataClient } from '@/lib/data';
import type { CaseChange, CaseLead, CaseOutcome } from '@/lib/db/schema';
import type { CloseCaseInput } from '@/lib/data/types';
import { claimWhat } from './claims';
import type { LeadSummary } from './useCaseWorkspace';

const OUTCOMES: CaseOutcome[] = ['answered', 'ruled_out', 'unresolved'];

const joined = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(', ');

/** A change that only replaces what the tree says: ticking it is ticking Replace. */
const onlyReplaces = (c: CaseChange) => c.kind === 'fill' && !c.fills.date && !c.fills.place;
const applies = (c: CaseChange) => c.kind === 'fill' || c.kind === 'event' || c.kind === 'cite';

/**
 * Answer and close (#58, ADR 0046), in the main column: the answer, the outcome,
 * then the changes to the tree by lead, each ticked on its own with the record
 * it comes from. A birth or death fills empty fields; what the tree says
 * otherwise is replaced only when ticked. Marriages, parents and people not in
 * the tree are listed to enter by hand. Unsettled leads say so.
 */
export function AnswerClose({ caseId, treeId, leads, summaries, busy, canReplace = true, onGoToLead, onCancel, onClose }: {
    caseId: number;
    treeId: number | null;
    leads: CaseLead[];
    summaries: LeadSummary[];
    busy: boolean;
    /** Replacing what the tree says takes Edit access; Contribute fills gaps and adds events only. */
    canReplace?: boolean;
    onGoToLead: (leadId: number) => void;
    onCancel: () => void;
    onClose: (input: CloseCaseInput) => void;
}) {
    const t = useTranslations('caseResearch');
    const id = useId();
    const [answer, setAnswer] = useState('');
    const [outcome, setOutcome] = useState<CaseOutcome>('answered');
    const [changes, setChanges] = useState<CaseChange[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [ticked, setTicked] = useState<Set<number>>(new Set());
    const [replace, setReplace] = useState<Set<number>>(new Set());

    useEffect(() => {
        let live = true;
        void (async () => {
            try {
                const list = await (await getDataClient()).cases.getChanges(caseId, treeId);
                if (!live) return;
                setChanges(list);
                setTicked(new Set(list.filter((c) => applies(c) && !onlyReplaces(c)).map((c) => c.claimId)));
            } catch (err) {
                if (live) setLoadError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => { live = false; };
    }, [caseId, treeId]);

    const unsettled = summaries.filter((s) => s.status !== 'settled');
    const groups = useMemo(() => {
        const list = (changes ?? []).filter((c) => c.kind !== 'by_hand');
        const inPlay = leads.filter((l) => l.DroppedAt == null);
        const byLead = inPlay.map((l) => ({ key: `l${l.Id}`, title: l.Question, items: list.filter((c) => c.leadIds.find((x) => inPlay.some((p) => p.Id === x)) === l.Id) }));
        const rest = list.filter((c) => !c.leadIds.some((x) => inPlay.some((p) => p.Id === x)));
        return [...byLead, { key: 'case', title: t('whole_case'), items: rest }].filter((g) => g.items.length > 0);
    }, [changes, leads, t]);
    const byHand = (changes ?? []).filter((c) => c.kind === 'by_hand');

    const toggle = (set: Set<number>, claimId: number) => {
        const next = new Set(set);
        if (next.has(claimId)) next.delete(claimId);
        else next.add(claimId);
        return next;
    };
    const ready = answer.trim() !== '' && !busy && changes != null;
    const close = (withChanges: boolean) => {
        if (!ready) return;
        const apply = withChanges
            ? (changes ?? []).filter((c) => ticked.has(c.claimId)).map((c) => ({ claimId: c.claimId, replace: onlyReplaces(c) || replace.has(c.claimId) }))
            : [];
        onClose({ conclusion: answer.trim(), outcome, apply });
    };

    const what = (c: CaseChange) => claimWhat(c.what, t);
    const detail = (c: CaseChange) => {
        if (c.kind === 'fill') {
            const value = joined(c.fills.date ? c.date : null, c.fills.place ? c.place : null);
            return value ? t('change_fill', { value }) : null;
        }
        if (c.kind === 'event') {
            const value = joined(c.date, c.place, c.says);
            return value ? t('change_event', { value }) : t('change_event_bare');
        }
        if (c.kind === 'cite') return t('change_cite');
        if (c.kind === 'in_tree') return t('change_in_tree');
        return joined(c.date, c.place, c.says) || null;
    };
    const replaceLabel = (c: CaseChange) => t('change_replace', {
        old: joined(c.differs.date, c.differs.place),
        new: joined(c.differs.date != null ? c.date : null, c.differs.place != null ? c.place : null),
    });
    const source = (c: CaseChange) => (c.sourceTitle ? t('change_from', { source: c.sourceTitle }) : null);

    return (
        <article aria-labelledby={`${id}-title`} className="grid gap-6">
            <header className="grid gap-1">
                <p className="eyebrow m-0">{t('case_section')}</p>
                <h2 id={`${id}-title`} className="title m-0 serif text-text">{t('answer_and_close')}</h2>
                <p className="m-0 text-sm text-text-muted">{t('close_intro')}</p>
            </header>

            <label className="grid gap-1.5 text-sm text-text-secondary">
                {t('your_answer')}
                <textarea rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} className={cx(fieldClass(), 'resize-y')} placeholder={t('your_answer_hint')} />
            </label>

            <div className="grid gap-1.5">
                <span aria-hidden="true" className="text-sm text-text-secondary">{t('outcome')}</span>
                <SegmentedControl aria-label={t('outcome')} value={outcome} onChange={(v) => setOutcome(v as CaseOutcome)}
                    options={OUTCOMES.map((o) => ({ v: o, l: t(`outcome_${o}`) }))} className="justify-self-start" />
            </div>

            {unsettled.length > 0 && (
                <section aria-labelledby={`${id}-unsettled`} className={cx('rounded-card', 'grid gap-2 bg-surface-2 p-4')}>
                    <h3 id={`${id}-unsettled`} className="m-0 text-sm font-semibold text-text">{t('close_unsettled', { count: unsettled.length })}</h3>
                    <ul className="m-0 p-0 list-none grid gap-1.5">
                        {unsettled.map((s) => (
                            <li key={s.lead.Id} className="flex items-center justify-between gap-3 text-sm">
                                <span className="min-w-0 break-words text-text">{s.lead.Question} <span className="text-text-muted">· {t(`status_${s.status}`)}</span></span>
                                <button type="button" onClick={() => onGoToLead(s.lead.Id)} className="shrink-0 bg-transparent border-0 p-0 text-sm text-link hover:underline cursor-pointer focus-ring rounded-sm">
                                    {t('go_to_lead')}
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <section aria-labelledby={`${id}-changes`} className="grid gap-3">
                <h3 id={`${id}-changes`} className="section m-0">{t('changes_title')}</h3>
                {loadError ? (
                    <p role="alert" className="m-0 text-sm text-error">{loadError}</p>
                ) : changes == null ? (
                    <p role="status" className="m-0 text-sm text-text-muted">{t('changes_loading')}</p>
                ) : groups.length === 0 ? (
                    <p className="m-0 text-sm text-text-muted">{t('changes_none')}</p>
                ) : groups.map((g) => (
                    <div key={g.key} className="grid gap-2">
                        <h4 className="eyebrow m-0 text-text-muted">{g.title}</h4>
                        <ul className={cx('rounded-card', 'm-0 p-0 list-none border border-border divide-y divide-border')}>
                            {g.items.map((c) => {
                                const head = <span className="text-sm font-medium text-text">{what(c)} · <span className="serif">{c.personLabel}</span></span>;
                                const lines = (
                                    <>
                                        {detail(c) && <span className="text-sm text-text-secondary break-words">{detail(c)}</span>}
                                        {source(c) && <span className="text-meta text-text-muted break-words">{source(c)}</span>}
                                    </>
                                );
                                if (c.kind === 'in_tree') {
                                    return <li key={c.claimId} className="grid gap-0.5 px-4 py-3 pl-11">{head}{lines}</li>;
                                }
                                const only = onlyReplaces(c);
                                return (
                                    <li key={c.claimId} className="grid gap-2 px-4 py-3">
                                        <label className="flex items-start gap-3 cursor-pointer">
                                            <input type="checkbox" className="mt-1" checked={ticked.has(c.claimId)} disabled={only && !canReplace}
                                                onChange={() => setTicked((s) => toggle(s, c.claimId))} />
                                            <span className="grid gap-0.5 min-w-0">
                                                {head}
                                                {only ? <span className="text-sm text-text-secondary break-words">{replaceLabel(c)}</span> : lines}
                                                {only && source(c) && <span className="text-meta text-text-muted break-words">{source(c)}</span>}
                                            </span>
                                        </label>
                                        {!only && canReplace && (c.differs.date != null || c.differs.place != null) && (
                                            <label className="flex items-start gap-3 pl-7 text-sm text-text-secondary cursor-pointer">
                                                <input type="checkbox" className="mt-0.5" checked={replace.has(c.claimId)} disabled={!ticked.has(c.claimId)}
                                                    onChange={() => setReplace((s) => toggle(s, c.claimId))} />
                                                <span className="break-words">{replaceLabel(c)}</span>
                                            </label>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </section>

            {byHand.length > 0 && (
                <section aria-labelledby={`${id}-by-hand`} className="grid gap-2">
                    <h3 id={`${id}-by-hand`} className="section m-0">{t('by_hand_title')}</h3>
                    <p className="m-0 text-sm text-text-muted">{t('by_hand_hint')}</p>
                    <ul className="m-0 p-0 list-none grid gap-2">
                        {byHand.map((c) => (
                            <li key={c.claimId} className="grid gap-0.5 text-sm">
                                <span className="text-text"><span className="font-medium">{what(c)}</span>{c.personLabel && <> · <span className="serif">{c.personLabel}</span></>}</span>
                                {detail(c) && <span className="text-text-secondary break-words">{detail(c)}</span>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-5">
                <Button variant="ghost" onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
                {ticked.size > 0 ? (
                    <>
                        <Button variant="outline" onClick={() => close(false)} disabled={!ready}>{t('close_without_changes')}</Button>
                        <Button onClick={() => close(true)} disabled={!ready}>{t('apply_and_close', { count: ticked.size })}</Button>
                    </>
                ) : (
                    <Button onClick={() => close(false)} disabled={!ready}>{t('close_case')}</Button>
                )}
            </footer>
        </article>
    );
}
