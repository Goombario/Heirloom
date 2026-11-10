/**
 * Source this fact: one fact → the search a record site receives (#1017
 * section 1, "Building the query"; #1025).
 *
 * The query holds the details the search box shows as chips: names, years,
 * place, spouse and sex. The person can edit or drop any of them, so
 * `readiness` takes a query, not a fact.
 *
 * Pure: no DB, no DOM.
 */

import { civilFromDays, dateInterval } from '@/lib/date-intervals';
import { splitDateQualifier } from '@/lib/date-qualifiers';
import { parsePlace, type ResearchPlace } from '@/lib/research/places';

export type FactKind =
    | 'name' | 'birth' | 'census' | 'residence' | 'marriage' | 'immigration' | 'death' | 'burial'
    /** Any other event: offered only the worldwide catch-all sites. */
    | 'other';

export const FACT_KINDS: readonly FactKind[] = [
    'name', 'birth', 'census', 'residence', 'marriage', 'immigration', 'death', 'burial', 'other',
];

/** GEDCOM event tag → the kind of record that would source it. */
const EVENT_KINDS: Record<string, FactKind> = {
    BIRT: 'birth',
    CHR: 'birth',
    BAPM: 'birth',
    CENS: 'census',
    RESI: 'residence',
    IMMI: 'immigration',
    EMIG: 'immigration',
    NATU: 'immigration',
    MARR: 'marriage',
    DEAT: 'death',
    PROB: 'death',
    BURI: 'burial',
};

export function factKindForEvent(type: string): FactKind {
    return EVENT_KINDS[type.toUpperCase()] ?? 'other';
}

export interface YearRange {
    from: number;
    to: number;
    /** From a `BEF`/`AFT` date: one side is a 10-year guess. */
    openEnded: boolean;
}

/** An exact date searches this many years either side, for late registration and index errors. */
const EXACT_SLACK_YEARS = 1;
/** `BEF`/`AFT` search this many years on the open side. */
const OPEN_SPAN_YEARS = 10;
/** A Ready search spans at most this many years. */
const READY_MAX_SPAN_YEARS = 10;

const yearOf = (day: number) => civilFromDays(day).y;

/**
 * A stored date → the years to search, or null for an empty value, a date
 * phrase or an unreadable date. `ABT`/`EST`/`CAL` are already ±5 in
 * `dateInterval`, and `BET a AND b` searches a to b.
 */
export function searchYears(stored: string | null | undefined): YearRange | null {
    const interval = dateInterval(stored);
    if (!interval || !stored) return null;
    const start = Number.isFinite(interval.earliest) ? yearOf(interval.earliest) : null;
    const end = Number.isFinite(interval.latest) ? yearOf(interval.latest) : null;
    if (start === null && end === null) return null;
    if (start === null) return { from: end! - OPEN_SPAN_YEARS, to: end!, openEnded: true };
    if (end === null) return { from: start, to: start + OPEN_SPAN_YEARS, openEnded: true };
    const prefix = splitDateQualifier(stored)?.prefix;
    if (!prefix || prefix === 'INT') {
        return { from: start - EXACT_SLACK_YEARS, to: end + EXACT_SLACK_YEARS, openEnded: false };
    }
    return { from: start, to: end, openEnded: false };
}

interface NameFields {
    FirstName: string | null;
    LastName: string | null;
}

interface ResearchPersonInput extends NameFields {
    Sex: string | null;
    BirthDate: string | null;
    BirthPlace: string | null;
    DeathDate: string | null;
}

/** One of the person's families. */
interface ResearchMarriageInput {
    /** The family's stored marriage date. */
    date: string | null;
    spouse: NameFields | null;
}

interface ResearchNameVariantInput {
    Type: string;
    Name: string;
    FromDate: string | null;
}

interface ResearchFactInput {
    kind: FactKind;
    date: string | null;
    place: string | null;
    /** For a marriage fact, its own family. */
    marriage?: ResearchMarriageInput;
}

export interface ResearchInput {
    fact: ResearchFactInput;
    person: ResearchPersonInput;
    marriages: ResearchMarriageInput[];
    nameVariants: ResearchNameVariantInput[];
}

export interface ResearchQuery {
    kind: FactKind;
    given: string;
    surname: string;
    /** The other surname (maiden or married), offered as a one-tap swap. */
    altSurname: string | null;
    sex: 'F' | 'M' | null;
    years: YearRange | null;
    place: ResearchPlace | null;
    /** Sent for a marriage, and for a death, burial or immigration under a married surname. */
    spouse: { given: string; surname: string } | null;
    /** The person's own birth and death years, which some sites take with any fact. */
    birth: YearRange | null;
    death: YearRange | null;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
const startYear = (stored: string | null) => {
    const i = dateInterval(stored);
    return i && Number.isFinite(i.earliest) ? yearOf(i.earliest) : null;
};

interface DatedMarriage extends ResearchMarriageInput {
    year: number | null;
    marriedSurname: string;
}

/**
 * The married surname a family gave, from the person's `Married` name
 * variants: the one ending in the spouse's surname, else the one dated within
 * this marriage, else the only one when there is one family.
 */
function marriedSurnames(input: ResearchInput): DatedMarriage[] {
    const variants = input.nameVariants
        .filter(v => v.Type === 'Married' && clean(v.Name))
        .map(v => ({ name: clean(v.Name), year: startYear(v.FromDate) }));
    const dated = input.marriages
        .map(m => ({ ...m, year: startYear(m.date), marriedSurname: '' }))
        .sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
    dated.forEach((m, i) => {
        const spouseSurname = clean(m.spouse?.LastName);
        const next = dated[i + 1]?.year ?? Infinity;
        const bySpouse = spouseSurname && variants.find(v => same(v.name, spouseSurname) || v.name.toLowerCase().endsWith(` ${spouseSurname.toLowerCase()}`));
        if (bySpouse) {
            m.marriedSurname = spouseSurname;
            return;
        }
        const byDate = m.year !== null && variants.find(v => v.year !== null && v.year >= m.year! && v.year < next);
        const only = dated.length === 1 && variants.length === 1 && variants[0];
        const variant = byDate || only;
        if (variant) m.marriedSurname = variant.name.split(' ').pop()!;
    });
    return dated;
}

/**
 * The family in force at the time of the fact: the latest marriage that
 * starts in or before the fact's first year. An undated death or burial takes
 * the last marriage.
 */
function marriageAt(marriages: DatedMarriage[], fact: ResearchFactInput, years: YearRange | null): DatedMarriage | undefined {
    const factYear = startYear(fact.date) ?? years?.from ?? null;
    if (factYear === null) {
        return fact.kind === 'death' || fact.kind === 'burial' ? marriages[marriages.length - 1] : undefined;
    }
    return marriages.filter(m => m.year !== null && m.year <= factYear).pop();
}

const SPOUSE_KINDS: readonly FactKind[] = ['death', 'burial', 'immigration'];

/** The stored place a search sends: the fact's, or the birthplace for a name. */
export function researchPlaceText(input: ResearchInput): string | null {
    return input.fact.kind === 'name' ? input.person.BirthPlace : input.fact.place;
}

/**
 * `placeAncestry` is that place's gazetteer chain, root first (#1030), so a place
 * written without its country still gets the regional sites it is filed under.
 */
export function buildResearchQuery(input: ResearchInput, placeAncestry: readonly string[] = []): ResearchQuery {
    const { fact, person } = input;
    const birth = searchYears(person.BirthDate);
    const years = fact.kind === 'name' ? birth : searchYears(fact.date);
    const place = parsePlace(researchPlaceText(input), placeAncestry);
    const maiden = clean(person.LastName);
    const marriages = marriedSurnames(input);

    let surname = maiden;
    let altSurname = '';
    let spouse: NameFields | null = null;
    if (fact.kind === 'marriage') {
        spouse = fact.marriage?.spouse ?? null;
    } else {
        const current = marriageAt(marriages, fact, years);
        if (current?.marriedSurname) {
            surname = current.marriedSurname;
            altSurname = maiden;
            if (SPOUSE_KINDS.includes(fact.kind)) spouse = current.spouse;
        } else {
            altSurname = marriages.find(m => m.marriedSurname)?.marriedSurname ?? '';
        }
    }
    if (!surname) [surname, altSurname] = [altSurname, ''];
    const sex = clean(person.Sex).toUpperCase();

    return {
        kind: fact.kind,
        given: clean(person.FirstName),
        surname,
        altSurname: altSurname && !same(altSurname, surname) ? altSurname : null,
        sex: sex === 'F' || sex === 'M' ? sex : null,
        years,
        place,
        spouse: spouse && (clean(spouse.FirstName) || clean(spouse.LastName))
            ? { given: clean(spouse.FirstName), surname: clean(spouse.LastName) }
            : null,
        birth,
        death: searchYears(person.DeathDate),
    };
}

type ReadinessLevel = 'ready' | 'thin' | 'not_enough';

/** Each reason is a message key under `research.readiness`. */
export type ReadinessReason =
    | 'no_surname' | 'no_year_or_place'
    | 'no_given' | 'no_year' | 'no_place' | 'wide_range' | 'open_ended';

export interface Readiness {
    level: ReadinessLevel;
    reasons: ReadinessReason[];
}

/**
 * Ready: surname, given name, a closed range of 10 years or less, and a
 * place. Thin: short of Ready, but a surname plus a year or a place. Not
 * enough: no surname, or no year and no place.
 */
export function readiness(q: Pick<ResearchQuery, 'given' | 'surname' | 'years' | 'place'>): Readiness {
    if (!q.surname.trim()) return { level: 'not_enough', reasons: ['no_surname'] };
    if (!q.years && !q.place) return { level: 'not_enough', reasons: ['no_year_or_place'] };
    const reasons: ReadinessReason[] = [];
    if (!q.given.trim()) reasons.push('no_given');
    if (!q.years) reasons.push('no_year');
    else if (q.years.to - q.years.from > READY_MAX_SPAN_YEARS) reasons.push('wide_range');
    else if (q.years.openEnded) reasons.push('open_ended');
    if (!q.place) reasons.push('no_place');
    return { level: reasons.length ? 'thin' : 'ready', reasons };
}
