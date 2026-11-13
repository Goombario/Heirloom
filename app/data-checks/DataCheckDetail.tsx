'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Button, IconButton, buttonClass, cx, fieldClass, showErrorToast } from '@/app/components/ui';
import InlineDateEditor from '@/app/components/InlineDateEditor';
import { familyEventLabel } from '@/app/components/familyEventTypes';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Pencil } from '@/lib/icons';
import { formatDateForDisplay } from '@/lib/date-utils';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { displayGivenNames } from '@/lib/utils/names';
import { errorToastKey } from '@/lib/utils/data-error';
import { getDataClient } from '@/lib/data';
import { dateClearsProblem } from '@/lib/data-checks/preview';
import type { DataCheckFact, DataCheckInput } from '@/lib/data-checks/rules';
import type { DataCheckEntry } from '@/lib/data/types';
import { personName, timelineRows } from './model';
import { KindMark } from './DataCheckList';
import type { useDataCheckText } from './useDataCheckText';

interface DataCheckDetailProps {
    entry: DataCheckEntry;
    text: ReturnType<typeof useDataCheckText>;
    /** 1-based position in the filtered list, and its length, for the stepper. */
    position: number;
    total: number;
    onStep: (delta: -1 | 1) => void;
    /** Re-run the checks after a confirmation or a reopen. */
    onChanged: (message: string) => void;
    /** Re-run the checks after a date is fixed in place, and move on (#832). */
    onFixed: () => Promise<void>;
    /** Editors and contributors can confirm, and fix a date; viewers can't (#830, #832). */
    canConfirm: boolean;
    /** Owners and editors can reopen: it deletes someone's confirmation (#830). */
    canReopen: boolean;
    treeId: number | null;
}

/**
 * The desktop Data checks detail (#831, locked list-pages board): a header with
 * the kind as its eyebrow, the problem as one serif sentence and why it's
 * flagged; the dates involved, earliest first, with only the row or rows to fix
 * marked; and a footer with the ‹ 1 of 4 › stepper, the person's page and, for
 * an unlikely check, "Confirm as correct". Impossible checks can only be fixed.
 */
export const DataCheckDetail = forwardRef<HTMLHeadingElement, DataCheckDetailProps>(function DataCheckDetail(
    { entry, text, position, total, onStep, onChanged, onFixed, canConfirm, canReopen, treeId },
    headingRef,
) {
    const t = useTranslations('dataChecks');
    const { byId, unknown, sentence } = text;
    const person = byId.get(entry.personId);
    const [confirming, setConfirming] = useState(false);
    const canConfirmThis = entry.kind === 'unlikely' && canConfirm && !entry.confirmation;
    const confirmButton = useRef<HTMLButtonElement>(null);
    const stepButton = 'w-8 h-8 inline-flex items-center justify-center rounded-[8px] border border-border bg-card';

    return (
        <div className="flex flex-col h-full" data-testid="data-check-detail">
            <div className="px-6 pt-5 pb-4 border-b border-border">
                <span className={cx('inline-flex items-center gap-[7px] text-xs font-semibold uppercase tracking-[0.07em]',
                    entry.kind === 'impossible' ? 'text-error' : 'text-text-muted')}>
                    <KindMark kind={entry.kind} />{t(`kind_${entry.kind}`)}
                </span>
                <h2 ref={headingRef} tabIndex={-1} className="title-dialog mt-1.5 mb-1 outline-none">{sentence(entry)}</h2>
                <WhyNote entry={entry} />
            </div>

            {entry.facts.length > 0 && (
                <DataCheckTimeline entry={entry} text={text} canEdit={canConfirm} treeId={treeId} onFixed={onFixed} />
            )}

            {(entry.confirmation || confirming) && (
                <div className="px-6 pb-4">
                    {entry.confirmation ? (
                        <ConfirmedNote entry={entry} canReopen={canReopen} treeId={treeId} onChanged={onChanged} />
                    ) : (
                        <ConfirmForm entry={entry} treeId={treeId} onChanged={onChanged}
                            onCancel={() => { setConfirming(false); requestAnimationFrame(() => confirmButton.current?.focus()); }} />
                    )}
                </div>
            )}

            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 border-t border-border bg-card-alt">
                <div className="flex items-center gap-2">
                    <IconButton label={t('previous_entry')} icon={<ChevronLeft className="w-4 h-4" />} onClick={() => onStep(-1)}
                        disabled={position <= 1} className={stepButton} />
                    <span className="text-sm text-text tabular-nums">{t('entry_position', { current: position, total })}</span>
                    <IconButton label={t('next_entry')} icon={<ChevronRight className="w-4 h-4" />} onClick={() => onStep(1)}
                        disabled={position >= total} className={stepButton} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/people/view?id=${entry.personId}`} className={buttonClass({ variant: 'outline', size: 'sm' })}>
                        {t('open_person', { name: person ? displayGivenNames(person) || personName(person, unknown) : unknown })}
                        <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </Link>
                    {canConfirmThis && !confirming && (
                        <Button ref={confirmButton} variant="outline" size="sm" onClick={() => setConfirming(true)}
                            icon={<Check className="w-3.5 h-3.5" aria-hidden="true" />}>{t('confirm_as_correct')}</Button>
                    )}
                </div>
            </div>
        </div>
    );
});

/** Why it's flagged: the header's plain paragraph under the sentence. */
function WhyNote({ entry }: { entry: DataCheckEntry }) {
    const t = useTranslations('dataChecks');
    const key = entry.kind === 'unreadable' ? 'why_unreadable'
        : entry.rule === 'own_ancestor' ? 'why_own_ancestor'
        : entry.rule === 'living_too_old' ? 'why_living_too_old'
        : entry.kind === 'unlikely' ? 'why_unlikely'
        : entry.editable.length > 1 ? 'why_impossible_both'
        : 'why_impossible';
    return (
        <p className="m-0 max-w-[62ch] text-sm text-text-secondary">
            {t(key)}
            {entry.kind === 'unlikely' && !entry.confirmation && <> <strong className="font-semibold text-text">{t('please_confirm')}</strong></>}
        </p>
    );
}

/** A fact's row label: "Mary Ellen died", "Partnership started", "Thomas: Baptism". */
export function useFactLabel(text: ReturnType<typeof useDataCheckText>) {
    const t = useTranslations('dataChecks');
    const tEvent = useTranslations('eventTypes');
    const tFamilyEvent = useTranslations('eventEdit');
    return (fact: DataCheckFact) => {
        const p = fact.personId != null ? text.byId.get(fact.personId) : undefined;
        const name = p ? displayGivenNames(p) || personName(p, text.unknown) : text.unknown;
        if (fact.table === FACT_TABLES.PERSON_BIRTH) return t('row_birth', { name });
        if (fact.table === FACT_TABLES.PERSON_DEATH) return t('row_death', { name });
        if (fact.table === FACT_TABLES.FAMILIES) return t('row_partnership');
        if (fact.personId == null) return familyEventLabel(fact.type, tFamilyEvent);
        return t('row_event', { name, event: tEvent.has(fact.type) ? tEvent(fact.type) : fact.type });
    };
}

/** Store a fixed date where the fact lives: a person's column, the family's start, or an event (#832). */
export async function saveFactDate(fact: DataCheckFact, date: string, treeId: number | null): Promise<void> {
    const client = await getDataClient();
    switch (fact.table) {
        case FACT_TABLES.PERSON_BIRTH: await client.people.update(fact.id, { BirthDate: date }, treeId); return;
        case FACT_TABLES.PERSON_DEATH: await client.people.update(fact.id, { DeathDate: date }, treeId); return;
        case FACT_TABLES.FAMILIES: await client.families.update(fact.id, { MarriageDate: date }, treeId); return;
        case FACT_TABLES.EVENTS: await client.events.update(fact.id, { Date: date }, treeId); return;
    }
}

/**
 * The dates involved, earliest first. Only the rows to fix are marked, with
 * the 3px orange edge (the signal that must stay: 6.8:1 on the tint in light,
 * 9.3:1 in dark) and the warning tint. Every other row is plain, with its date
 * in the normal evidence amber: never recolour a date orange (#831).
 *
 * Each row to fix has an always-visible "Edit date" (#832), which turns the row
 * into a date editor. One editor is open at a time, and closing it returns focus
 * to its button. The timeline is a container: below 480px the button is a 44px
 * pencil and the date column narrows. Every resting row is as tall as the
 * button's, so the button never makes one row taller than the rest.
 */
function DataCheckTimeline({ entry, text, canEdit, treeId, onFixed }: {
    entry: DataCheckEntry; text: ReturnType<typeof useDataCheckText>; canEdit: boolean; treeId: number | null; onFixed: () => Promise<void>;
}) {
    const t = useTranslations('dataChecks');
    const locale = useLocale();
    const words = useDateQualifierWords();
    const label = useFactLabel(text);
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState<string | null>(null);
    const [input, setInput] = useState<DataCheckInput | null>(null);
    const buttons = useRef(new Map<string, HTMLButtonElement>());
    const returnFocus = useRef<string | null>(null);
    const fixable = canEdit && !entry.confirmation ? entry.editable : [];

    useEffect(() => {
        if (editing != null || returnFocus.current == null) return;
        buttons.current.get(returnFocus.current)?.focus();
        returnFocus.current = null;
    }, [editing]);

    // The dates this person's problems depend on, fetched once an editor opens,
    // so the hint can re-run the checks in the browser as you type.
    const wantsInput = editing != null && input == null;
    useEffect(() => {
        if (!wantsInput) return;
        let cancelled = false;
        (async () => {
            try {
                const client = await getDataClient();
                const loaded = await client.dataChecks.neighbourhood(entry.personId, treeId);
                if (!cancelled) setInput(loaded);
            } catch {
                // Best-effort: without it the editor just shows no hint.
            }
        })();
        return () => { cancelled = true; };
    }, [wantsInput, entry.personId, treeId]);

    const open = (fact: DataCheckFact) => { setDraft(fact.date); setEditing(fact.key); };
    const close = () => { returnFocus.current = editing; setEditing(null); };

    return (
        <ol className="dc-timeline px-6 py-1.5" aria-label={t('timeline')}>
            {timelineRows(entry).map(({ fact, toFix }) => {
                const rowLabel = label(fact);
                const edge = toFix && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-[3px] bg-warning-text" />;
                // The row to fix bleeds to the panel's edges, its tint fading out (board ".tlr.bad").
                const tint = toFix && '-mx-6 px-6 bg-[linear-gradient(90deg,var(--color-warning-bg),transparent_70%)]';
                if (editing === fact.key) {
                    const changed = draft != null && draft.trim() !== '' && draft !== fact.date;
                    const clears = changed && input ? dateClearsProblem(input, entry.id, fact, draft) : null;
                    return (
                        <li key={fact.key} className="relative -mx-6 px-6 py-3 border-t border-border-light first:border-t-0 bg-warning-bg">
                            {edge}
                            <InlineDateEditor label={rowLabel} value={fact.date} onDraft={setDraft} onCancel={close}
                                onSave={async (date) => {
                                    await saveFactDate(fact, date, treeId);
                                    close();
                                    await onFixed();
                                }}
                                hint={
                                    <p role="status" className={cx('m-0 min-h-5 text-meta', clears ? 'text-success font-medium' : 'text-text-secondary')}>
                                        {clears == null ? null : t(clears ? 'fix_clears' : 'fix_does_not_clear')}
                                    </p>
                                } />
                        </li>
                    );
                }
                const canFix = fixable.includes(fact.key);
                const named = t('edit_date_named', { label: rowLabel });
                return (
                    <li key={fact.key}
                        className={cx(
                            'relative grid grid-cols-[100px_16px_minmax(0,1fr)_auto] @min-[480px]:grid-cols-[110px_16px_minmax(0,1fr)_auto] items-center gap-3 py-3 text-sm border-t border-border-light first:border-t-0',
                            fixable.length > 0 && 'min-h-[57px]',
                            tint,
                        )}>
                        {edge}
                        <span className="date-mono">{formatDateForDisplay(fact.date, locale, words)}</span>
                        <span aria-hidden="true" className={cx('justify-self-center w-[9px] h-[9px] rounded-full border-[1.5px] box-border',
                            toFix ? 'bg-warning-text border-warning-text' : 'border-text-muted')} />
                        <span className="min-w-0 text-text">
                            {rowLabel}
                            {toFix && <small className="block text-meta text-text-muted">{t('row_to_fix')}</small>}
                        </span>
                        {canFix ? (
                            <Button variant="outline" size="sm" className="dc-fix-btn" aria-label={named} title={named}
                                ref={(el) => { if (el) buttons.current.set(fact.key, el); else buttons.current.delete(fact.key); }}
                                onClick={() => open(fact)}>
                                <Pencil className="w-4 h-4" aria-hidden="true" />
                                <span className="dc-fix-label">{t('edit_date')}</span>
                            </Button>
                        ) : <span />}
                    </li>
                );
            })}
        </ol>
    );
}

function ConfirmForm({ entry, treeId, onChanged, onCancel }: {
    entry: DataCheckEntry; treeId: number | null; onChanged: (m: string) => void; onCancel: () => void;
}) {
    const t = useTranslations('dataChecks');
    const tCommon = useTranslations('common');
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const id = `confirm-reason-${entry.id}`;

    const submit = async () => {
        if (!reason.trim()) return;
        setSaving(true);
        try {
            const client = await getDataClient();
            await client.dataChecks.confirm(entry.id, reason.trim(), treeId);
            onChanged(t('confirmed_toast'));
        } catch (e) {
            showErrorToast(tCommon(errorToastKey(e)));
            setSaving(false);
        }
    };
    return (
        <form className="flex flex-col gap-2 rounded-[10px] border border-border bg-card p-3"
            onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <label htmlFor={id} className="text-meta font-semibold text-text-secondary">{t('reason_label')}</label>
            <textarea id={id} required autoFocus rows={3} maxLength={1000} value={reason}
                onChange={(e) => setReason(e.target.value)} aria-describedby={`${id}-hint`}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
                className={fieldClass()} />
            <span id={`${id}-hint`} className="text-meta text-text-muted">{t('reason_hint')}</span>
            <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" size="sm" disabled={!reason.trim() || saving}>{t('confirm')}</Button>
                <Button type="button" variant="outline" size="sm" onClick={onCancel}>{tCommon('cancel')}</Button>
            </div>
        </form>
    );
}

function ConfirmedNote({ entry, canReopen, treeId, onChanged }: {
    entry: DataCheckEntry; canReopen: boolean; treeId: number | null; onChanged: (m: string) => void;
}) {
    const t = useTranslations('dataChecks');
    const tCommon = useTranslations('common');
    const { timestamp } = useTimestamp();
    const [saving, setSaving] = useState(false);
    const c = entry.confirmation!;
    const date = timestamp(c.confirmedAt);
    const reopen = async () => {
        setSaving(true);
        try {
            const client = await getDataClient();
            await client.dataChecks.reopen(entry.id, treeId);
            onChanged(t('reopened_toast'));
        } catch (e) {
            showErrorToast(tCommon(errorToastKey(e)));
            setSaving(false);
        }
    };
    return (
        <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-card p-3 text-sm">
            <span className="text-meta text-text-muted">
                {c.confirmedByName ? t('confirmed_by', { name: c.confirmedByName, date }) : t('confirmed_by_unknown', { date })}
            </span>
            <p className="m-0 text-text">{c.reason}</p>
            {canReopen && (
                <div>
                    <Button variant="outline" size="sm" onClick={() => void reopen()} disabled={saving}>{t('reopen')}</Button>
                </div>
            )}
        </div>
    );
}
