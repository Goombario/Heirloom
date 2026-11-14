'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
    EmptyState, GlassButton, InlineDataError, MobileListFilters, MobileListHeader, MobileListPager, MobileListToggleChip,
    MobileRow, PageShell, RadioRow, SegmentedControl, cx, fieldClass, showErrorToast,
} from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { SkeletonList } from '@/app/components/SkeletonLoader';
import PersonAvatar from '@/app/components/PersonAvatar';
import DateInput from '@/app/components/DateInput';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, RotateCcw } from '@/lib/icons';
import { formatDateForDisplay } from '@/lib/date-utils';
import { getInitials } from '@/lib/utils/initials';
import { errorToastKey } from '@/lib/utils/data-error';
import { getDataClient } from '@/lib/data';
import { dateClearsProblem } from '@/lib/data-checks/preview';
import type { DataCheckFact, DataCheckInput, DataCheckKind, DataCheckRuleId } from '@/lib/data-checks/rules';
import type { DataCheckEntry } from '@/lib/data/types';
import { involvedPeople, personName, timelineRows, type DataCheckTab, type EntryGroup, type RuleCount } from './model';
import { saveFactDate, useFactLabel } from './DataCheckDetail';
import type { useDataCheckText } from './useDataCheckText';

type Text = ReturnType<typeof useDataCheckText>;
const KIND_ORDER: DataCheckKind[] = ['impossible', 'unlikely', 'unreadable'];
const KIND_GROUP: Record<DataCheckKind, string> = { impossible: 'group_impossible', unlikely: 'group_unlikely', unreadable: 'group_unreadable' };

/**
 * The Data checks list on a phone (#1122): the people-list standard with the To check /
 * Confirmed switch under the header, the name filter, then a full-width "Show: All
 * checks ⌄" field (option A) that opens the grouped check sheet. An eyebrow per check
 * with its count (orange for impossible), rows with no end icon.
 */
export function MobileDataChecksList(p: {
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    tab: DataCheckTab;
    onTab: (tab: DataCheckTab) => void;
    query: string;
    onQuery: (q: string) => void;
    rule: DataCheckRuleId | null;
    onRule: (rule: DataCheckRuleId | null) => void;
    counts: RuleCount[];
    /** Entries before the check is picked, for "All checks". */
    filteredCount: number;
    /** Checks that found nothing, under the sheet's list. */
    clean: number;
    groups: EntryGroup[];
    entryCount: number;
    inTabCount: number;
    page: number;
    pages: number;
    onPage: (page: number) => void;
    hrefFor: (id: string) => string;
    family: { label: string; onClear: () => void } | null;
    onReset: () => void;
    text: Text;
    treeId: number | null;
}) {
    const t = useTranslations('dataChecks');
    const tm = useTranslations('mobileDataChecks');
    const tc = useTranslations('common');
    const [rules, setRules] = useState(false);
    const kindOf = (rule: DataCheckRuleId) => p.counts.find((c) => c.rule === rule)?.kind;

    return (
        <PageShell topBar={<MobileListHeader title={t('title')} />} contentClassName="max-md:p-0!" busy={p.loading}>
            <div className="px-4 pt-2.5 bg-surface">
                <SegmentedControl aria-label={t('status_label')} fullWidth value={p.tab} onChange={(v) => p.onTab(v as DataCheckTab)}
                    options={[{ v: 'open', l: t('tab_open') }, { v: 'confirmed', l: t('tab_confirmed') }]} />
            </div>
            <MobileListFilters value={p.query} onChange={p.onQuery} placeholder={tm('filter_name')}>
                <div className="flex flex-col gap-2 w-full">
                    <button type="button" onClick={() => setRules(true)} aria-haspopup="dialog"
                        className={cx(fieldClass(), 'flex items-center gap-2 w-full !h-11 pl-3.5 pr-3 text-left cursor-pointer')}>
                        <span className="text-sm text-text-muted">{t('filter_label')}</span>
                        <span className="flex-1 min-w-0 truncate text-md font-semibold text-text">{p.rule ? p.text.ruleName(p.rule) : t('all_checks')}</span>
                        <ChevronDown className="w-[18px] h-[18px] text-text-muted shrink-0" aria-hidden="true" />
                    </button>
                    {p.family && (
                        <div className="flex">
                            <MobileListToggleChip label={p.family.label} on clearLabel={t('remove_family_filter')} onTap={p.family.onClear} onClear={p.family.onClear} />
                        </div>
                    )}
                </div>
            </MobileListFilters>

            {p.error ? (
                <div className="p-4"><InlineDataError message={p.error} retryLabel={tc('retry')} onRetry={p.onRetry} /></div>
            ) : p.loading ? (
                <div className="pt-4"><SkeletonList rows={6} /></div>
            ) : p.inTabCount === 0 ? (
                <EmptyState variant="empty" title={t(p.tab === 'open' ? 'empty_open_title' : 'empty_confirmed_title')}
                    message={t(p.tab === 'open' ? 'empty_open_body' : 'empty_confirmed_body')} />
            ) : p.entryCount === 0 ? (
                <EmptyState variant="filtered" message={t('empty_filtered')} clearLabel={t('clear_filters')} onClear={p.onReset} />
            ) : (
                <nav aria-label={t('entries_label')}>
                    <div className="flex items-center justify-between gap-3 min-h-11 px-4 pt-3 pb-1 text-meta text-text-muted">
                        <span className="font-mono">{tm('entries', { count: p.entryCount })}</span>
                        <span>{tm('impossible_first')}</span>
                    </div>
                    {p.groups.map((g) => (
                        <section key={g.rule} aria-labelledby={`mdc-${g.rule}`}>
                            <h2 id={`mdc-${g.rule}`} className={cx('eyebrow m-0 flex justify-between gap-2.5 px-4 pt-4 pb-1.5', kindOf(g.rule) === 'impossible' && '!text-warning-text')}>
                                <span>{p.text.ruleName(g.rule)}</span><span className="font-mono normal-case tracking-normal font-normal">{g.total}</span>
                            </h2>
                            <ul className="m-0 p-0 list-none">
                                {g.entries.map((e, i) => {
                                    const person = p.text.byId.get(e.personId);
                                    const name = personName(person, p.text.unknown);
                                    return (
                                        <li key={e.id}>
                                            <Link href={p.hrefFor(e.id)} scroll={false}
                                                className={cx('flex items-center gap-3 min-h-[60px] px-4 py-[11px] no-underline text-inherit active:bg-surface-2 focus-ring-inset', i > 0 && 'border-t border-border')}>
                                                <PersonAvatar as="span" size={40} sex={person?.Sex} name={name} initials={getInitials(person?.FirstName, person?.LastName)} treeId={p.treeId} />
                                                <span className="flex-1 min-w-0 grid gap-0.5">
                                                    <span className="serif text-md font-semibold truncate">{name}</span>
                                                    <span className="text-meta text-text-muted truncate">{p.text.summary(e)}</span>
                                                </span>
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    ))}
                    <MobileListPager page={p.page} pages={p.pages} onPage={p.onPage} />
                </nav>
            )}
            <div className="h-8" aria-hidden="true" />

            <Sheet open={rules} onClose={() => setRules(false)} title={t('filter_label')}>
                <div role="radiogroup" aria-label={t('filter_label')} className="-mx-4 -mt-3">
                    <RadioRow checked={p.rule == null} label={t('all_checks')} hint={tm('entries', { count: p.filteredCount })} divided={false}
                        onSelect={() => { p.onRule(null); setRules(false); }} />
                    {KIND_ORDER.map((kind) => {
                        const inKind = p.counts.filter((c) => c.kind === kind);
                        if (inKind.length === 0) return null;
                        return (
                            <div key={kind}>
                                <div className={cx('eyebrow px-4 pt-4 pb-1.5 border-t border-border', kind === 'impossible' && '!text-warning-text')}>{t(KIND_GROUP[kind])}</div>
                                {inKind.map((c, i) => (
                                    <RadioRow key={c.rule} checked={p.rule === c.rule} label={p.text.ruleName(c.rule)} hint={tm('entries', { count: c.count })}
                                        divided={i > 0} onSelect={() => { p.onRule(c.rule); setRules(false); }} />
                                ))}
                            </div>
                        );
                    })}
                </div>
                {p.tab === 'open' && p.clean > 0 && <p className="m-0 pt-3 text-meta text-text-muted">{t('clean_checks', { count: p.clean })}</p>}
            </Sheet>
        </PageShell>
    );
}

/**
 * One entry, full screen on a phone (#1122): a dark row with the menu, "Entry 3 of 23" and
 * up and down; the kind and the check; the people as rows to their pages; why it's
 * flagged; the timeline, where a marked row is the button that opens its date sheet;
 * then Confirm as correct or Reopen as action rows.
 */
export function MobileDataCheckEntry({ entry, text, position, total, onStep, onChanged, onFixed, canConfirm, canReopen, treeId }: {
    entry: DataCheckEntry;
    text: Text;
    position: number;
    total: number;
    onStep: (delta: -1 | 1) => void;
    onChanged: (message: string) => void;
    onFixed: () => Promise<void>;
    canConfirm: boolean;
    canReopen: boolean;
    treeId: number | null;
}) {
    const t = useTranslations('dataChecks');
    const tm = useTranslations('mobileDataChecks');
    const tc = useTranslations('common');
    const locale = useLocale();
    const words = useDateQualifierWords();
    const label = useFactLabel(text);
    const { timestamp } = useTimestamp();
    const [fixing, setFixing] = useState<DataCheckFact | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [saving, setSaving] = useState(false);
    const fixable = canConfirm && !entry.confirmation ? entry.editable : [];
    const why = entry.kind === 'unreadable' ? 'why_unreadable'
        : entry.rule === 'own_ancestor' ? 'why_own_ancestor'
        : entry.rule === 'living_too_old' ? 'why_living_too_old'
        : entry.kind === 'unlikely' ? 'why_unlikely'
        : entry.editable.length > 1 ? 'why_impossible_both'
        : 'why_impossible';

    const reopen = async () => {
        setSaving(true);
        try {
            const client = await getDataClient();
            await client.dataChecks.reopen(entry.id, treeId);
            onChanged(t('reopened_toast'));
        } catch (e) {
            showErrorToast(tc(errorToastKey(e)));
            setSaving(false);
        }
    };

    const c = entry.confirmation;
    return (
        <PageShell
            topBar={<MobileListHeader
                title={<span className="font-sans text-sm font-medium text-white/80">{tm('entry_of', { current: position, total })}</span>}
                trail={<>
                    <GlassButton label={t('previous_entry')} icon={<ChevronUp />} onClick={() => onStep(-1)} disabled={position <= 1} />
                    <GlassButton label={t('next_entry')} icon={<ChevronDown />} onClick={() => onStep(1)} disabled={position >= total} />
                </>} />}
            contentClassName="max-md:p-0!">
            <div data-testid="data-check-detail">
                <div className="px-4 pt-[18px] pb-1.5">
                    <span className={cx('eyebrow', entry.kind === 'impossible' && '!text-warning-text')}>{t(`kind_${entry.kind}`)}</span>
                    <h2 className="m-0 mt-1 serif text-xl font-semibold leading-tight">{text.ruleName(entry.rule)}</h2>
                    <p className="m-0 mt-1.5 text-base text-text-secondary">{text.sentence(entry)}</p>
                </div>
                <ul className="m-0 p-0 list-none">
                    {involvedPeople(entry).map((id, i) => {
                        const person = text.byId.get(id);
                        const name = personName(person, text.unknown);
                        return (
                            <li key={id}>
                                <MobileRow divided={i > 0} end="leave" href={`/people/view?id=${id}`}
                                    lead={<PersonAvatar as="span" size={40} sex={person?.Sex} name={name} initials={getInitials(person?.FirstName, person?.LastName)} treeId={treeId} />}
                                    label={<span className="serif text-md font-semibold">{name}</span>} />
                            </li>
                        );
                    })}
                </ul>
                <p className="m-0 px-4 pt-1.5 text-base leading-normal text-text-secondary">
                    {t(why)}
                    {entry.kind === 'unlikely' && !c && <> <strong className="font-semibold text-text">{t('please_confirm')}</strong></>}
                </p>
                {c && (
                    <div className="mx-4 mt-3 px-3.5 py-3 border-l-[3px] border-success bg-card text-sm leading-normal text-text-secondary">
                        <b className="font-semibold text-text">
                            {c.confirmedByName ? t('confirmed_by', { name: c.confirmedByName, date: timestamp(c.confirmedAt) }) : t('confirmed_by_unknown', { date: timestamp(c.confirmedAt) })}
                        </b>{' '}{c.reason}
                    </div>
                )}

                {entry.facts.length > 0 && (
                    <>
                        <h2 className="eyebrow m-0 px-4 pt-5 pb-1.5">{t('timeline')}</h2>
                        <ol className="m-0 p-0 list-none">
                            {timelineRows(entry).map(({ fact, toFix }, i) => {
                                const canFix = fixable.includes(fact.key);
                                const body = (
                                    <>
                                        <span className="date-mono text-sm font-medium">{formatDateForDisplay(fact.date, locale, words)}</span>
                                        <span className="min-w-0">
                                            {label(fact)}
                                            {toFix && <span className="block text-meta font-medium text-warning-text">{t('row_to_fix')}</span>}
                                        </span>
                                        {canFix ? <ChevronRight className="w-4 h-4 text-text-muted" aria-hidden="true" /> : <span />}
                                    </>
                                );
                                const cls = cx('relative grid grid-cols-[104px_minmax(0,1fr)_auto] items-center gap-3 w-full min-h-[52px] px-4 py-[11px] text-left text-base',
                                    i > 0 && 'border-t border-border', toFix && 'bg-warning-bg');
                                const edge = toFix && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-[3px] bg-warning-text" />;
                                return (
                                    <li key={fact.key}>
                                        {canFix
                                            ? <button type="button" onClick={() => setFixing(fact)} aria-haspopup="dialog" aria-label={t('edit_date_named', { label: label(fact) })}
                                                className={cx(cls, 'cursor-pointer focus-ring-inset active:brightness-95')}>{edge}{body}</button>
                                            : <div className={cls}>{edge}{body}</div>}
                                    </li>
                                );
                            })}
                        </ol>
                    </>
                )}

                {(c ? canReopen : entry.kind === 'unlikely' && canConfirm) && (
                    <div className="mt-3 border-t border-border">
                        {c
                            ? <MobileRow icon={<RotateCcw className="w-[18px] h-[18px]" aria-hidden="true" />} label={t('reopen')} sub={tm('reopen_hint')} disabled={saving} onClick={() => void reopen()} />
                            : <MobileRow icon={<CheckCircle2 className="w-[18px] h-[18px]" aria-hidden="true" />} label={t('confirm_as_correct')} sub={tm('confirm_hint')} onClick={() => setConfirming(true)} />}
                    </div>
                )}
                <div className="h-8" aria-hidden="true" />
            </div>

            {fixing && <DateSheet key={fixing.key} entry={entry} fact={fixing} label={label(fixing)} treeId={treeId}
                onClose={() => setFixing(null)} onSaved={async () => { setFixing(null); await onFixed(); }} />}
            <ReasonSheet open={confirming} entry={entry} treeId={treeId} onClose={() => setConfirming(false)}
                onDone={(m) => { setConfirming(false); onChanged(m); }} />
        </PageShell>
    );
}

/** The marked date's typing sheet: the date with its Kind menu and About box, and whether it clears the problem. */
function DateSheet({ entry, fact, label, treeId, onClose, onSaved }: {
    entry: DataCheckEntry; fact: DataCheckFact; label: string; treeId: number | null; onClose: () => void; onSaved: () => Promise<void>;
}) {
    const t = useTranslations('dataChecks');
    const tc = useTranslations('common');
    const id = useId();
    const [draft, setDraft] = useState(fact.date ?? '');
    const [input, setInput] = useState<DataCheckInput | null>(null);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const client = await getDataClient();
                const loaded = await client.dataChecks.neighbourhood(entry.personId, treeId);
                if (!cancelled) setInput(loaded);
            } catch {
                // Best-effort: without it the sheet just shows no hint.
            }
        })();
        return () => { cancelled = true; };
    }, [entry.personId, treeId]);
    const changed = draft.trim() !== '' && draft !== fact.date;
    const clears = changed && input ? dateClearsProblem(input, entry.id, fact, draft) : null;
    const save = async () => {
        setSaving(true);
        try {
            await saveFactDate(fact, draft, treeId);
            await onSaved();
        } catch (e) {
            showErrorToast(tc(errorToastKey(e)));
            setSaving(false);
        }
    };
    return (
        <Sheet open onClose={onClose} title={label} size="full" dirty={changed} onSave={save} saveDisabled={!changed || saving}>
            <div className="grid gap-1.5 pt-1">
                <label htmlFor={id} className="text-meta font-semibold text-text-secondary">{t('row_to_fix')}</label>
                <DateInput id={id} value={draft} onChange={setDraft} touch className={cx(fieldClass(), 'min-h-11')} />
                <p role="status" className={cx('m-0 min-h-5 text-meta', clears ? 'text-success font-medium' : 'text-text-secondary')}>
                    {clears == null ? null : t(clears ? 'fix_clears' : 'fix_does_not_clear')}
                </p>
            </div>
        </Sheet>
    );
}

function ReasonSheet({ open, entry, treeId, onClose, onDone }: {
    open: boolean; entry: DataCheckEntry; treeId: number | null; onClose: () => void; onDone: (message: string) => void;
}) {
    const t = useTranslations('dataChecks');
    const tc = useTranslations('common');
    const id = useId();
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) { setReason(''); setSaving(false); }
    }
    const submit = async () => {
        if (!reason.trim()) return;
        setSaving(true);
        try {
            const client = await getDataClient();
            await client.dataChecks.confirm(entry.id, reason.trim(), treeId);
            onDone(t('confirmed_toast'));
        } catch (e) {
            showErrorToast(tc(errorToastKey(e)));
            setSaving(false);
        }
    };
    return (
        <Sheet open={open} onClose={onClose} title={t('confirm_as_correct')} size="full" dirty={reason.trim() !== ''}
            onSave={submit} saveLabel={t('confirm')} saveDisabled={!reason.trim() || saving}>
            <div className="grid gap-1.5 pt-1">
                <label htmlFor={id} className="text-meta font-semibold text-text-secondary">{t('reason_label')}</label>
                <textarea id={id} rows={5} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={`${id}-hint`}
                    className={cx(fieldClass(), 'min-h-[110px] text-md')} />
                <span id={`${id}-hint`} className="text-meta text-text-muted">{t('reason_hint')}</span>
            </div>
        </Sheet>
    );
}
