/**
 * The Data checks page's pure model (#831): filtering, grouping, paging and the
 * detail timeline, over the problems the engine returns. No React, no DOM, so
 * the home card (#834) and the inline marks (#833) can reuse it.
 */

import { DATA_CHECK_RULES, DIED_YOUNG_MAX_AGE, FATHER_DEATH_MONTHS, ruleThreshold, type DataCheckFact, type DataCheckKind, type DataCheckRuleId } from '@/lib/data-checks/rules';
import { civilFromDays, dateInterval } from '@/lib/date-intervals';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { displayFullName } from '@/lib/utils/names';
import { foldForSearch } from '@/lib/utils/search-fold';
import type { DataCheckEntry, DataChecksResult } from '@/lib/data/types';

export const PAGE_SIZE = 25;

/** To check, or Confirmed (unlikely problems confirmed as correct, #830). */
export type DataCheckTab = 'open' | 'confirmed';

export type DataCheckPeople = DataChecksResult['people'];
type PersonName = DataCheckPeople[number];

export interface DataCheckFilters {
    tab: DataCheckTab;
    /** One rule, or null for all checks. */
    rule: DataCheckRuleId | null;
    /** A family from the hero flag (#833), or null. */
    familyId: number | null;
    /** Free text, matched accent-insensitively against the entry's person (#792). */
    query: string;
}

export function personName(p: PersonName | undefined, unknown: string): string {
    return (p && displayFullName(p)) || unknown;
}

export function peopleById(people: DataCheckPeople): Map<number, PersonName> {
    return new Map(people.map((p) => [p.Id, p]));
}

/** The entries on one side of the To check / Confirmed switch. */
export function entriesInTab(problems: DataCheckEntry[], tab: DataCheckTab): DataCheckEntry[] {
    return problems.filter((p) => (tab === 'confirmed') === (p.confirmation != null));
}

/**
 * The filtered list, in the engine's order: impossible checks first, then by
 * rule, then by person. The rule filter is applied last so the menu's counts
 * (`ruleCounts`) can be taken from the same list without it.
 */
export function filterEntries(
    problems: DataCheckEntry[],
    filters: Omit<DataCheckFilters, 'rule'>,
    people: Map<number, PersonName>,
): DataCheckEntry[] {
    const q = foldForSearch(filters.query.trim());
    return entriesInTab(problems, filters.tab).filter((p) => {
        if (filters.familyId != null && !p.familyIds.includes(filters.familyId)) return false;
        if (!q) return true;
        const person = people.get(p.personId);
        return person != null && foldForSearch(displayFullName(person)).includes(q);
    });
}

export function applyRule(entries: DataCheckEntry[], rule: DataCheckRuleId | null): DataCheckEntry[] {
    return rule ? entries.filter((p) => p.rule === rule) : entries;
}

export interface RuleCount {
    rule: DataCheckRuleId;
    kind: DataCheckKind;
    count: number;
}

/** Checks that found something, in display order; the "All checks" menu lists only these. */
export function ruleCounts(entries: DataCheckEntry[]): RuleCount[] {
    const counts = new Map<DataCheckRuleId, number>();
    for (const p of entries) counts.set(p.rule, (counts.get(p.rule) ?? 0) + 1);
    return DATA_CHECK_RULES.filter((r) => counts.has(r.id)).map((r) => ({ rule: r.id, kind: r.kind, count: counts.get(r.id)! }));
}

export interface EntryGroup {
    rule: DataCheckRuleId;
    /** Entries for this rule in the whole filtered list, not just this page. */
    total: number;
    entries: DataCheckEntry[];
}

/** One page of the list, grouped by check. */
export function pageGroups(entries: DataCheckEntry[], page: number): EntryGroup[] {
    const totals = new Map<DataCheckRuleId, number>();
    for (const p of entries) totals.set(p.rule, (totals.get(p.rule) ?? 0) + 1);
    const groups: EntryGroup[] = [];
    for (const p of entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
        const last = groups[groups.length - 1];
        if (last?.rule === p.rule) last.entries.push(p);
        else groups.push({ rule: p.rule, total: totals.get(p.rule)!, entries: [p] });
    }
    return groups;
}

export interface KindGroup {
    kind: DataCheckKind;
    /** Entries of this kind in the whole filtered list, not just this page. */
    total: number;
    entries: DataCheckEntry[];
}

/**
 * One page of the desktop list, grouped by kind: Impossible, Unlikely, Can't be
 * checked (locked list-pages board). The list is in rule order, impossible first,
 * so each kind is one run; the rule is each row's own sub-line.
 */
export function pageKindGroups(entries: DataCheckEntry[], page: number): KindGroup[] {
    const totals = new Map<DataCheckKind, number>();
    for (const p of entries) totals.set(p.kind, (totals.get(p.kind) ?? 0) + 1);
    const groups: KindGroup[] = [];
    for (const p of entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
        const last = groups[groups.length - 1];
        if (last?.kind === p.kind) last.entries.push(p);
        else groups.push({ kind: p.kind, total: totals.get(p.kind)!, entries: [p] });
    }
    return groups;
}

/** The year a list row shows: the date to check's, else the first date's; null when none reads as a date. */
export function entryYear(p: DataCheckEntry): number | null {
    const rows = timelineRows(p);
    const fact = (rows.find((r) => r.toFix) ?? rows[0])?.fact;
    const range = fact ? dateInterval(fact.date) : null;
    if (!range) return null;
    const { earliest: e, latest: l } = range;
    // "ABT 1850" spans years either side, so its middle; "BEF"/"AFT" have one open end.
    const day = Number.isFinite(e) && Number.isFinite(l) ? Math.round((e + l) / 2) : Number.isFinite(e) ? e : Number.isFinite(l) ? l : null;
    return day == null ? null : civilFromDays(day).y;
}

export function pageCount(entries: DataCheckEntry[]): number {
    return Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
}

export function pageOfIndex(index: number): number {
    return Math.floor(Math.max(0, index) / PAGE_SIZE) + 1;
}

/**
 * The number a rule's message counts: the other people for a rule about
 * children, the events for an event rule, and the dates for an unreadable one.
 */
export function entryCount(p: DataCheckEntry): number {
    switch (p.rule) {
        case 'event_before_birth':
        case 'event_after_death':
            return p.facts.filter((f) => f.table === FACT_TABLES.EVENTS).length;
        case 'unreadable_date':
            return p.facts.length;
        default:
            return p.relatedPersonIds.length;
    }
}

/** The ICU arguments every rule message may use. */
export function messageArgs(p: DataCheckEntry, people: Map<number, PersonName>, unknown: string) {
    const person = people.get(p.personId);
    const sex = person?.Sex?.trim().charAt(0).toUpperCase();
    return {
        name: personName(person, unknown),
        sex: sex === 'F' || sex === 'M' ? sex : 'other',
        count: entryCount(p),
        threshold: p.threshold ?? 0,
        age: DIED_YOUNG_MAX_AGE,
        months: FATHER_DEATH_MONTHS,
    };
}

/** The rule name's arguments, for the menu, where no entry is to hand. */
export function ruleArgs(rule: DataCheckRuleId) {
    return { threshold: ruleThreshold(rule) ?? 0, age: DIED_YOUNG_MAX_AGE };
}

export interface TimelineRow {
    fact: DataCheckFact;
    /** One of the problem's `editable` dates: the row the check would have you fix. */
    toFix: boolean;
}

/** The dates involved, earliest first; an unreadable date sorts last. */
export function timelineRows(p: DataCheckEntry): TimelineRow[] {
    const editable = new Set(p.editable);
    const start = (f: DataCheckFact) => dateInterval(f.date)?.earliest ?? Infinity;
    return [...p.facts]
        .sort((a, b) => start(a) - start(b))
        .map((fact) => ({ fact, toFix: editable.has(fact.key) }));
}

/** The people chips: the entry's person, then the others involved. */
export function involvedPeople(p: DataCheckEntry): number[] {
    return [p.personId, ...p.relatedPersonIds];
}
