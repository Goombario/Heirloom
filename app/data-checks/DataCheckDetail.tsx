'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, Button, IconButton, SectionHeader, cx, fieldClass, showErrorToast } from '@/app/components/ui';
import PersonAvatar from '@/app/components/PersonAvatar';
import InlineDateEditor from '@/app/components/InlineDateEditor';
import { familyEventLabel } from '@/app/components/familyEventTypes';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { ChevronLeft, ChevronRight, Info, Pencil } from '@/lib/icons';
import { formatDateForDisplay } from '@/lib/date-utils';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { getInitials } from '@/lib/utils/initials';
import { displayGivenNames } from '@/lib/utils/names';
import { errorToastKey } from '@/lib/utils/data-error';
import { getDataClient } from '@/lib/data';
import { dateClearsProblem } from '@/lib/data-checks/preview';
import type { DataCheckFact, DataCheckInput } from '@/lib/data-checks/rules';
import type { DataCheckEntry } from '@/lib/data/types';
import { involvedPeople, personName, timelineRows } from './model';
import type { useDataCheckText } from './useDataCheckText';

/** Phones show three people chips, then "+N" (#831). */
const PHONE_CHIPS = 3;

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
    /** Phones: the "‹ Back to list" link. */
    backHref: string;
    treeId: number | null;
}

/**
 * The Data checks detail (#831): the kind and check, the problem as one serif
 * sentence, the people involved, a neutral note on why it's flagged, and the
 * dates involved with only the row or rows to fix marked. Unlikely checks can
 * be confirmed as correct with a reason; impossible ones can only be fixed.
 */
export const DataCheckDetail = forwardRef<HTMLHeadingElement, DataCheckDetailProps>(function DataCheckDetail(
    { entry, text, position, total, onStep, onChanged, onFixed, canConfirm, canReopen, backHref, treeId },
    headingRef,
) {
    const t = useTranslations('dataChecks');
    const tCommon = useTranslations('common');
    const { byId, unknown, ruleName, sentence } = text;
    const person = byId.get(entry.personId);
    const people = involvedPeople(entry);
    const stepper = (
        <span className="inline-flex items-center gap-1.5 text-meta text-text-muted whitespace-nowrap">
            {t('entry_position', { current: position, total })}
            <IconButton label={t('previous_entry')} icon={<ChevronLeft className="w-4 h-4" />} onClick={() => onStep(-1)}
                disabled={position <= 1} className="w-8 h-8 inline-flex items-center justify-center border border-border bg-card" />
            <IconButton label={t('next_entry')} icon={<ChevronRight className="w-4 h-4" />} onClick={() => onStep(1)}
                disabled={position >= total} className="w-8 h-8 inline-flex items-center justify-center border border-border bg-card" />
        </span>
    );

    return (
        <div className="flex flex-col gap-3.5 p-0 pb-28 md:p-6 md:pb-6" data-testid="data-check-detail">
            <Link href={backHref} className="md:hidden inline-flex items-center gap-1 min-h-6 text-sm text-link hover:underline self-start">
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />{t('back_to_list')}
            </Link>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                    <Badge tone={entry.kind === 'impossible' ? 'warning' : 'neutral'}>{t(`kind_${entry.kind}`)}</Badge>
                    <span>{ruleName(entry.rule)}</span>
                </div>
                <span className="hidden md:inline-flex">{stepper}</span>
            </div>

            <h2 ref={headingRef} tabIndex={-1} className="title-dialog outline-none">{sentence(entry)}</h2>

            <ul className="flex flex-wrap gap-1.5">
                {people.map((id, i) => {
                    const p = byId.get(id);
                    const name = personName(p, unknown);
                    return (
                        <li key={id} className={cx(i >= PHONE_CHIPS && 'hidden md:block')}>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-0.5 pr-2.5 text-meta font-medium">
                                <PersonAvatar as="span" size={22} sex={p?.Sex} name={name}
                                    initials={getInitials(p?.FirstName, p?.LastName)} treeId={treeId} />
                                {name}
                            </span>
                        </li>
                    );
                })}
                {people.length > PHONE_CHIPS && (
                    <li className="md:hidden">
                        <span className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-0.5 text-meta text-text-muted">
                            {t('more_people', { count: people.length - PHONE_CHIPS })}
                        </span>
                    </li>
                )}
            </ul>

            <WhyNote entry={entry} />

            {entry.facts.length > 0 && (
                <section className="flex flex-col gap-2">
                    <SectionHeader level="rail" title={t('timeline')} className="mb-0" />
                    <DataCheckTimeline entry={entry} text={text} canEdit={canConfirm} treeId={treeId} onFixed={onFixed} />
                </section>
            )}

            {entry.confirmation ? (
                <ConfirmedNote entry={entry} canReopen={canReopen} treeId={treeId} onChanged={onChanged} />
            ) : entry.kind === 'unlikely' && canConfirm ? (
                <ConfirmForm entry={entry} treeId={treeId} onChanged={onChanged} />
            ) : null}

            <div>
                <Link href={`/people/view?id=${entry.personId}`}
                    className="inline-flex items-center gap-1 min-h-6 text-sm text-link hover:underline">
                    {t('open_person', { name: person ? displayGivenNames(person) || personName(person, unknown) : unknown })}
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Link>
            </div>

            {/* Phones: Previous / Next fixed to the bottom, clear of the safe area (the Faces toolbar's recipe). */}
            <div className="md:hidden fixed inset-x-0 bottom-0 z-30 grid grid-cols-[1fr_auto_1fr] items-center gap-2.5 border-t border-border bg-card px-4 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
                <Button variant="outline" size="lg" onClick={() => onStep(-1)} disabled={position <= 1} aria-label={t('previous_entry')}>
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />{tCommon('previous')}
                </Button>
                <span className="text-meta text-text-muted text-center">{t('entry_position', { current: position, total })}</span>
                <Button variant="outline" size="lg" onClick={() => onStep(1)} disabled={position >= total} aria-label={t('next_entry')}>
                    {tCommon('next')}<ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Button>
            </div>
        </div>
    );
});

/** Why it's flagged: a neutral card-alt note, not a blue info Banner (#831). */
function WhyNote({ entry }: { entry: DataCheckEntry }) {
    const t = useTranslations('dataChecks');
    const key = entry.kind === 'unreadable' ? 'why_unreadable'
        : entry.rule === 'own_ancestor' ? 'why_own_ancestor'
        : entry.rule === 'living_too_old' ? 'why_living_too_old'
        : entry.kind === 'unlikely' ? 'why_unlikely'
        : entry.editable.length > 1 ? 'why_impossible_both'
        : 'why_impossible';
    return (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-border bg-card-alt px-3 py-2.5 text-sm text-text-secondary">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
            <p className="m-0">
                {t(key)}
                {entry.kind === 'unlikely' && !entry.confirmation && <> <strong className="font-semibold text-text">{t('please_confirm')}</strong></>}
            </p>
        </div>
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
        <ol className="dc-timeline rounded-[10px] border border-border bg-card overflow-hidden">
            {timelineRows(entry).map(({ fact, toFix }) => {
                const rowLabel = label(fact);
                const edge = toFix && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-[3px] bg-warning-text" />;
                if (editing === fact.key) {
                    const changed = draft != null && draft.trim() !== '' && draft !== fact.date;
                    const clears = changed && input ? dateClearsProblem(input, entry.id, fact, draft) : null;
                    return (
                        <li key={fact.key} className="relative px-3.5 py-2.5 border-t border-border-light first:border-t-0 bg-warning-bg">
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
                            'relative grid grid-cols-[100px_minmax(0,1fr)_auto] @min-[480px]:grid-cols-[118px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 text-sm border-t border-border-light first:border-t-0',
                            fixable.length > 0 && 'min-h-[65px] @min-[480px]:min-h-[53px]',
                            toFix && 'bg-warning-bg',
                        )}>
                        {edge}
                        <span className="date-mono">{formatDateForDisplay(fact.date, locale, words)}</span>
                        <span>
                            {rowLabel}
                            {toFix && <span className="sr-only"> ({t('row_to_fix')})</span>}
                        </span>
                        {canFix && (
                            <Button variant="outline" size="sm" className="dc-fix-btn" aria-label={named} title={named}
                                ref={(el) => { if (el) buttons.current.set(fact.key, el); else buttons.current.delete(fact.key); }}
                                onClick={() => open(fact)}>
                                <Pencil className="w-4 h-4" aria-hidden="true" />
                                <span className="dc-fix-label">{t('edit_date')}</span>
                            </Button>
                        )}
                    </li>
                );
            })}
        </ol>
    );
}

function ConfirmForm({ entry, treeId, onChanged }: { entry: DataCheckEntry; treeId: number | null; onChanged: (m: string) => void }) {
    const t = useTranslations('dataChecks');
    const tCommon = useTranslations('common');
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const id = `confirm-reason-${entry.id}`;

    if (!open) {
        return (
            <div>
                <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{t('confirm_as_correct')}</Button>
            </div>
        );
    }
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
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}
                className={fieldClass()} />
            <span id={`${id}-hint`} className="text-meta text-text-muted">{t('reason_hint')}</span>
            <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" size="sm" disabled={!reason.trim() || saving}>{t('confirm')}</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>{tCommon('cancel')}</Button>
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
