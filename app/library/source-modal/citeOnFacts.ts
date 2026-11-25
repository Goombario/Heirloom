import { FACT_TABLES, type FactTableValue } from '@/lib/db/fact-tables';
import { sortableYear } from '@/lib/date-utils';
import { compareTimelineItems, shouldRenderColumnBirth, shouldRenderColumnDeath } from '@/app/people/view/derive';
import { displayFullName } from '@/lib/utils/names';
import type { PersonWithRelations } from '@/lib/db/schema';
import type { FamilyDetail } from '@/lib/data/types';

/** One fact the "Cite on…" panel offers for a person (#799). */
export interface CiteOnFact {
    /** `"FactTable:FactId"`, the same key the citation maps use. */
    key: string;
    factTable: FactTableValue;
    factId: number;
    /** GEDCOM type code: BIRT, DEAT, or the event's own type. Labels and the per-type ticks use it. */
    type: string;
    date: string | null;
    place: string | null;
    /** A marriage in a person's block: the partner's name, for "Marriage to {name}" (#31). */
    partnerName?: string;
    /** The family a marriage belongs to; its family block, when present, shows it instead (#31). */
    familyId?: number;
    /** Other keys that also count as this fact already citing the source (an imported marriage citation). */
    alsoKeys?: string[];
}

export interface CiteOnPerson {
    id: number;
    /** Display name; empty when the person has none recorded. */
    name: string;
    birthDate: string | null;
    deathDate: string | null;
    facts: CiteOnFact[];
}

/** A family block (#31): the marriage and the family's own events, shown once above its members. */
export interface CiteOnFamily {
    id: number;
    /** The partners' display names; empty strings where a name isn't recorded. */
    partners: string[];
    marriageDate: string | null;
    facts: CiteOnFact[];
}

export const citeKey = (factTable: string, factId: number) => `${factTable}:${factId}`;

/** True when this fact already cites the source, under its own key or an equivalent one. */
export function isCitedFact(f: CiteOnFact, cited: ReadonlySet<string>): boolean {
    return cited.has(f.key) || (f.alsoKeys ?? []).some(k => cited.has(k));
}

/**
 * The marriage fact for a family. New citations go on the family record, as the
 * family page's own "+" does; an imported citation on the marriage itself
 * (FamilyMarriage, #962) counts as already cited.
 */
function marriageFact(familyId: number, date: string | null | undefined, place: string | null | undefined): CiteOnFact {
    return {
        key: citeKey(FACT_TABLES.FAMILIES, familyId),
        factTable: FACT_TABLES.FAMILIES,
        factId: familyId,
        type: 'MARR',
        date: date ?? null,
        place: place ?? null,
        familyId,
        alsoKeys: [citeKey(FACT_TABLES.FAMILY_MARRIAGE, familyId)],
    };
}

/** A family block's facts: the marriage first, as the family page starts with it, then its events in timeline order. */
export function citeOnFamilyFrom(familyId: number, detail: Partial<FamilyDetail>): CiteOnFamily {
    const f = { Id: familyId, MarriageDate: null, MarriagePlace: null, ...detail.family };
    const items: (CiteOnFact & { sortKey: number | null })[] = [];
    for (const e of detail.events ?? []) {
        items.push({ key: citeKey(FACT_TABLES.EVENTS, e.Id), factTable: FACT_TABLES.EVENTS, factId: e.Id, type: e.Type, date: e.Date ?? null, place: e.Place ?? null, familyId: f.Id, sortKey: sortableYear(e.Date) });
    }
    items.sort(compareTimelineItems);
    const partners = [detail.husband, detail.wife].filter((p): p is NonNullable<typeof p> => !!p).map(p => displayFullName(p));
    return {
        id: f.Id,
        partners,
        marriageDate: f.MarriageDate ?? null,
        facts: [marriageFact(f.Id, f.MarriageDate, f.MarriagePlace), ...items.map(({ sortKey: _sortKey, ...fact }) => fact)],
    };
}

/**
 * A person's citable facts in timeline order, as their page shows them: the
 * intrinsic birth and death rows (only when the page renders them) and every
 * life event. Offering a fact the page doesn't show would file the citation
 * somewhere the reader can't find it.
 */
export function citeOnPersonFrom(p: PersonWithRelations): CiteOnPerson {
    const items: (CiteOnFact & { sortKey: number | null })[] = [];
    if (shouldRenderColumnBirth(p)) {
        items.push({ key: citeKey(FACT_TABLES.PERSON_BIRTH, p.Id), factTable: FACT_TABLES.PERSON_BIRTH, factId: p.Id, type: 'BIRT', date: p.BirthDate ?? null, place: p.BirthPlace ?? null, sortKey: sortableYear(p.BirthDate) });
    }
    for (const e of p.events ?? []) {
        items.push({ key: citeKey(FACT_TABLES.EVENTS, e.Id), factTable: FACT_TABLES.EVENTS, factId: e.Id, type: e.Type, date: e.Date ?? null, place: e.Place ?? null, sortKey: sortableYear(e.Date) });
    }
    // Each of their marriages, as "Marriage to {name}" (#31).
    for (const sp of p.spouses ?? []) {
        const fam = sp.family;
        items.push({ ...marriageFact(fam.Id, fam.MarriageDate, fam.MarriagePlace), partnerName: sp.person ? displayFullName(sp.person) : '', sortKey: sortableYear(fam.MarriageDate) });
    }
    if (shouldRenderColumnDeath(p)) {
        items.push({ key: citeKey(FACT_TABLES.PERSON_DEATH, p.Id), factTable: FACT_TABLES.PERSON_DEATH, factId: p.Id, type: 'DEAT', date: p.DeathDate ?? null, place: p.DeathPlace ?? null, sortKey: sortableYear(p.DeathDate) });
    }
    items.sort(compareTimelineItems);
    return {
        id: p.Id,
        name: displayFullName(p),
        birthDate: p.BirthDate ?? null,
        deathDate: p.DeathDate ?? null,
        facts: items.map(({ sortKey: _sortKey, ...fact }) => fact),
    };
}

/**
 * The year a source is about, read from its title ("1901 Census of Asteria…").
 * A source has no date field, and a census or register title almost always
 * names its year. Null when the title names none.
 */
export function sourceYear(title: string | null | undefined): number | null {
    const match = title?.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
    return match ? Number(match[1]) : null;
}

/** The facts to tick when a person or family joins: the uncited ones dated in the source's year. */
export function preselectedKeys(block: { facts: CiteOnFact[] }, year: number | null, cited: ReadonlySet<string>): string[] {
    if (year === null) return [];
    return block.facts
        .filter(f => !isCitedFact(f, cited) && sortableYear(f.date) === year)
        .map(f => f.key);
}
