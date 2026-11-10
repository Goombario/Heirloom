import { FACT_TABLES, type FactTableValue } from '@/lib/db/fact-tables';
import { sortableYear } from '@/lib/date-utils';
import { compareTimelineItems, shouldRenderColumnBirth, shouldRenderColumnDeath } from '@/app/people/view/derive';
import { displayFullName } from '@/lib/utils/names';
import type { PersonWithRelations } from '@/lib/db/schema';

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
}

export interface CiteOnPerson {
    id: number;
    /** Display name; empty when the person has none recorded. */
    name: string;
    birthDate: string | null;
    deathDate: string | null;
    facts: CiteOnFact[];
}

export const citeKey = (factTable: string, factId: number) => `${factTable}:${factId}`;

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

/** The facts to tick when a person joins: the uncited ones dated in the source's year. */
export function preselectedKeys(person: CiteOnPerson, year: number | null, cited: ReadonlySet<string>): string[] {
    if (year === null) return [];
    return person.facts
        .filter(f => !cited.has(f.key) && sortableYear(f.date) === year)
        .map(f => f.key);
}
