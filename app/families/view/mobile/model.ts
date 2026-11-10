import type { FamilyType, GedcomEvent } from '@/lib/db/schema';
import { FACT_TABLES, type FactTableValue } from '@/lib/db/fact-tables';
import { formatYearOrEmpty, sortableYear } from '@/lib/date-utils';
import { isChildRelationshipType, type ChildRelationshipType } from '@/lib/child-relationship';
import type { PartnerPerson } from '../useFamilyDetail';
import { derivedEndPrecedesStart, earlierDeathPartner, endEventOf, endReasonOf, hasRecordedDeath, partnerShortName } from '../derive';

/*
 * Pure derivations for the phone family page (#1062, umbrella #1067): the couple's
 * name, how the partnership started and ended, the timeline and what it counts. No
 * React, no translations; the panes label the result.
 */

export interface PhoneFamily {
    family: { Id: number; Partner1Id: number | null; Partner2Id: number | null; MarriageDate: string | null; MarriagePlace: string | null; MarriagePlaceId?: number | null; Type: FamilyType | null };
    partner1: PartnerPerson | null;
    partner2: PartnerPerson | null;
    /** In birth order. */
    children: PartnerPerson[];
    events: GedcomEvent[];
    /** The children's adoption events (#485). */
    childAdoptions?: GedcomEvent[];
}

/** Which partner slot a person fills; the hero's left half is Partner 1. */
export type Slot = 'partner1' | 'partner2';

export const SLOT_COLUMN: Record<Slot, 'Partner1Id' | 'Partner2Id'> = { partner1: 'Partner1Id', partner2: 'Partner2Id' };

/** The partners present, in slot order. */
export function partnersOf(f: Pick<PhoneFamily, 'partner1' | 'partner2'>): { slot: Slot; person: PartnerPerson }[] {
    const out: { slot: Slot; person: PartnerPerson }[] = [];
    if (f.partner1) out.push({ slot: 'partner1', person: f.partner1 });
    if (f.partner2) out.push({ slot: 'partner2', person: f.partner2 });
    return out;
}

/** The first given name the hero shows, else the surname (the desktop hero's rule). */
const given = (p: PartnerPerson) => partnerShortName(p);
const surnameOf = (p: PartnerPerson) => (p.LastName ?? '').trim();

/**
 * The couple's name (#1062): "Anders & Greta Halvorsen" when the surnames match,
 * "Thomas Marsh & Ellen Pryce" when they don't, one name with one partner, and ''
 * with none (the caller says "Family").
 */
export function coupleName(p1: PartnerPerson | null, p2: PartnerPerson | null): string {
    const one = (p: PartnerPerson) => [given(p), surnameOf(p)].filter(Boolean).join(' ');
    if (p1 && p2) {
        const s1 = surnameOf(p1), s2 = surnameOf(p2);
        if (s1 && s1.toLocaleLowerCase() === s2.toLocaleLowerCase()) return `${given(p1) || '?'} & ${given(p2) || '?'} ${s1}`;
        return `${one(p1) || '?'} & ${one(p2) || '?'}`;
    }
    const p = p1 ?? p2;
    return p ? one(p) : '';
}

/** The eyebrow's word for the kind of partnership; Other and Unknown read "Partnership". */
export function kindKey(type: FamilyType | null | undefined): 'marriage' | 'civil_union' | 'common_law' | 'partnership' {
    return type === 'Marriage' ? 'marriage' : type === 'Civil union' ? 'civil_union' : type === 'Common-law' ? 'common_law' : 'partnership';
}

/** "Married" for a marriage, "Started" for the rest, as the vitals cell and the timeline say. */
export function startKey(type: FamilyType | null | undefined): 'married' | 'started' {
    return type === 'Marriage' ? 'married' : 'started';
}

/** How the partnership ended: a recorded divorce, annulment or separation, or a partner's death. */
export type UnionEnding =
    | { kind: 'event'; event: GedcomEvent; reason: 'Divorce' | 'Annulment' | 'Separation' }
    | { kind: 'death'; partner: PartnerPerson; date: string | null };

/**
 * The ending the vitals strip shows. A recorded end event wins over a death, as on
 * desktop. A death only ends a partnership with both partners known, and a death
 * before the start is a bad date, not an end (#826).
 */
export function endingOf(f: PhoneFamily): UnionEnding | null {
    const ev = endEventOf(f.events);
    const reason = ev ? endReasonOf(ev.Type) : null;
    if (ev && (reason === 'Divorce' || reason === 'Annulment' || reason === 'Separation')) return { kind: 'event', event: ev, reason };
    if (!f.partner1 || !f.partner2) return null;
    const first = earlierDeathPartner(f.partner1, f.partner2);
    if (!first || sortableYear(first.DeathDate) == null) return null;
    if (derivedEndPrecedesStart(first.DeathDate, f.family.MarriageDate)) return null;
    return { kind: 'death', partner: first, date: first.DeathDate ?? null };
}

/** "1893–1939", "~1871" (no end yet), "?–1921" (an end but no start), or ''. */
export function unionRange(f: PhoneFamily): string {
    const start = formatYearOrEmpty(f.family.MarriageDate);
    const end = endingOf(f);
    const endYear = end ? formatYearOrEmpty(end.kind === 'event' ? end.event.Date : end.date) : '';
    if (start && endYear) return `${start}–${endYear}`;
    if (endYear) return `?–${endYear}`;
    return start;
}

/** The Together cell: years together, and each partner's age at the start when known. */
export function togetherOf(f: PhoneFamily): { years: number | null; approx: boolean; ages: [number | null, number | null] } {
    const start = sortableYear(f.family.MarriageDate);
    const end = endingOf(f);
    const endYear = end ? sortableYear(end.kind === 'event' ? end.event.Date : end.date) : null;
    const age = (p: PartnerPerson | null) => {
        const b = sortableYear(p?.BirthDate);
        return p && b != null && start != null && start - b >= 0 ? start - b : null;
    };
    return {
        years: start != null && endYear != null && endYear >= start ? endYear - start : null,
        // "~1871", "<1871": the start's year isn't firm, so neither is the count.
        approx: /^[~<>]/.test(formatYearOrEmpty(f.family.MarriageDate)),
        ages: [age(f.partner1), age(f.partner2)],
    };
}

/** One timeline row. Children's rows and the worked-out end leave the page. */
export interface TimelineRow {
    key: string;
    kind: 'start' | 'event' | 'child-birth' | 'child-adoption' | 'child-death' | 'derived-end';
    date: string | null;
    place: string | null;
    sortKey: number | null;
    /** The event's type code (family events), the end event's when it ends the union. */
    type?: string;
    detail?: string | null;
    /** The person a child row or the worked-out end is about. */
    person?: PartnerPerson;
    /** The fact the row cites; none for the worked-out end. */
    fact?: { factTable: FactTableValue; factId: number };
    event?: GedcomEvent;
}

/**
 * The Timeline tab's rows (#1062): the start when it has a date or place, every
 * family event, each child's recorded birth, adoption (#485) and death, and the end worked out from
 * a partner's death. Dated rows by year, undated last; ties keep this order.
 */
export function timelineRows(f: PhoneFamily): TimelineRow[] {
    const rows: TimelineRow[] = [];
    if (f.family.MarriageDate || f.family.MarriagePlace) {
        rows.push({
            key: 'start', kind: 'start', date: f.family.MarriageDate, place: f.family.MarriagePlace, sortKey: sortableYear(f.family.MarriageDate),
            fact: { factTable: FACT_TABLES.FAMILIES, factId: f.family.Id },
        });
    }
    for (const e of f.events) {
        rows.push({
            key: `event-${e.Id}`, kind: 'event', date: e.Date ?? null, place: e.Place ?? null, sortKey: sortableYear(e.Date),
            type: e.Type, detail: e.Description ?? null, event: e, fact: { factTable: FACT_TABLES.EVENTS, factId: e.Id },
        });
    }
    for (const c of f.children) {
        if (c.BirthDate || c.BirthPlace) {
            rows.push({
                key: `birth-${c.Id}`, kind: 'child-birth', date: c.BirthDate ?? null, place: c.BirthPlace ?? null, sortKey: sortableYear(c.BirthDate),
                person: c, fact: { factTable: FACT_TABLES.PERSON_BIRTH, factId: c.Id },
            });
        }
        for (const e of f.childAdoptions ?? []) {
            if (e.PersonId !== c.Id) continue;
            rows.push({
                key: `adop-${e.Id}`, kind: 'child-adoption', date: e.Date ?? null, place: e.Place ?? null, sortKey: sortableYear(e.Date),
                person: c, event: e, fact: { factTable: FACT_TABLES.EVENTS, factId: e.Id },
            });
        }
        if (hasRecordedDeath(c)) {
            rows.push({
                key: `death-${c.Id}`, kind: 'child-death', date: c.DeathDate ?? null, place: c.DeathPlace ?? null, sortKey: sortableYear(c.DeathDate),
                person: c, fact: { factTable: FACT_TABLES.PERSON_DEATH, factId: c.Id },
            });
        }
    }
    const end = endingOf(f);
    if (end?.kind === 'death') {
        rows.push({ key: 'derived-end', kind: 'derived-end', date: end.date, place: null, sortKey: sortableYear(end.date), person: end.partner });
    }
    return rows
        .map((row, i) => ({ row, i }))
        .sort((a, b) => (a.row.sortKey ?? Infinity) - (b.row.sortKey ?? Infinity) || a.i - b.i)
        .map(({ row }) => row);
}

/** The facts the Sources tab counts: every timeline row but the worked-out end. */
export function sourcingFacts(f: PhoneFamily): TimelineRow[] {
    return timelineRows(f).filter((r) => r.fact);
}

/** A child's relationship to one partner slot, "Birth" when unrecorded or unknown to the app. */
export function childLink(child: PartnerPerson, slot: Slot): ChildRelationshipType {
    const v = slot === 'partner1' ? child.Partner1Relationship : child.Partner2Relationship;
    return isChildRelationshipType(v) ? v : 'Birth';
}

/** Common family event types for the Add event chooser, likeliest first. */
export const COMMON_FAMILY_EVENTS = ['ENGA', 'MARB', 'MARL', 'CENS', 'RESI', 'DIV', 'SEPA', 'ANUL'] as const;

/** Events that end a partnership, which open the "How it ended" sheet. */
const END_TYPES = ['DIV', 'ANUL', 'SEPA'] as const;
export type EndType = (typeof END_TYPES)[number];

/** True for a type the "How it ended" sheet edits (DIVF is a filing, not an end). */
export function isEndType(type: string): type is EndType {
    return (END_TYPES as readonly string[]).includes(type);
}

/**
 * Children to suggest in Add child (#1062): people with no parents yet who share a
 * partner's surname and were born while the partners could have had children.
 * With no birth or start year to go on, the surname alone narrows.
 */
export function suggestChildren<T extends { Id: number; LastName: string | null; BirthDate: string | null; FatherName?: string | null; MotherName?: string | null }>(
    f: PhoneFamily, pool: T[], limit = 6,
): T[] {
    const norm = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase();
    const surnames = new Set([f.partner1, f.partner2].map((p) => norm(p?.LastName)).filter(Boolean));
    if (surnames.size === 0) return [];
    const skip = new Set([f.partner1?.Id, f.partner2?.Id, ...f.children.map((c) => c.Id)]);
    const births = [f.partner1, f.partner2].map((p) => sortableYear(p?.BirthDate)).filter((y): y is number => y != null);
    const start = sortableYear(f.family.MarriageDate);
    const from = births.length ? Math.max(...births) + 14 : start != null ? start - 5 : null;
    const to = births.length ? Math.min(...births) + 55 : start != null ? start + 30 : null;
    return pool
        .filter((p) => !skip.has(p.Id) && !p.FatherName && !p.MotherName && surnames.has(norm(p.LastName)))
        .filter((p) => {
            if (from == null || to == null) return true;
            const y = sortableYear(p.BirthDate);
            return y != null && y >= from && y <= to;
        })
        .sort((a, b) => (sortableYear(a.BirthDate) ?? Infinity) - (sortableYear(b.BirthDate) ?? Infinity))
        .slice(0, limit);
}
