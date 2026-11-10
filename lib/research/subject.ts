/**
 * Source this fact: a person's or family's fact → the input the query builder
 * takes, plus what the search tab's living warning needs (#1017 section 1;
 * #1028). The person and family pages already hold everything it reads.
 *
 * Pure: no DB, no DOM.
 */

import { FACT_TABLES } from '@/lib/db/fact-tables';
import { mayBeLiving } from '@/lib/living';
import { factKindForEvent, type ResearchInput } from '@/lib/research/fact-query';

interface SubjectPerson {
    FirstName: string | null;
    LastName: string | null;
    Sex: string | null;
    BirthDate: string | null;
    BirthPlace: string | null;
    DeathDate: string | null;
    DeathPlace: string | null;
    IsDeceased: number | null;
}

interface SubjectEvent {
    Id: number;
    Type: string;
    Date: string | null;
    Place: string | null;
}

interface SubjectFamily {
    Id: number;
    MarriageDate: string | null;
    MarriagePlace: string | null;
}

interface SubjectNameVariant {
    Type: string;
    Name: string;
    FromDate: string | null;
}

export interface ResearchSubject {
    input: ResearchInput;
    /** The person's first name, for the living warning. */
    firstName: string;
    /** Not marked deceased, and born within 100 years or with no birth date. */
    mayBeLiving: boolean;
}

function subject(person: SubjectPerson, input: Omit<ResearchInput, 'person'>, nowYear: number): ResearchSubject {
    return {
        input: { ...input, person },
        firstName: (person.FirstName ?? '').trim().split(/\s+/)[0] ?? '',
        mayBeLiving: mayBeLiving(person, nowYear),
    };
}

/**
 * A fact on the person page. Returns null for a fact the page doesn't hold,
 * such as an event that has since been deleted.
 */
export function personResearchSubject(
    person: SubjectPerson & {
        events?: SubjectEvent[];
        spouses?: { person: Pick<SubjectPerson, 'FirstName' | 'LastName'> | null; family: SubjectFamily }[];
    },
    nameVariants: SubjectNameVariant[],
    factTable: string,
    factId: number,
    nowYear: number,
): ResearchSubject | null {
    const marriages = (person.spouses ?? []).map(s => ({ date: s.family.MarriageDate, spouse: s.person }));
    const base = { marriages, nameVariants };
    switch (factTable) {
        case FACT_TABLES.PERSON_BIRTH:
            return subject(person, { ...base, fact: { kind: 'birth', date: person.BirthDate, place: person.BirthPlace } }, nowYear);
        case FACT_TABLES.PERSON_DEATH:
            return subject(person, { ...base, fact: { kind: 'death', date: person.DeathDate, place: person.DeathPlace } }, nowYear);
        case FACT_TABLES.PEOPLE:
        case FACT_TABLES.PERSON_NAME:
        case FACT_TABLES.NAME_VARIANT:
            return subject(person, { ...base, fact: { kind: 'name', date: null, place: null } }, nowYear);
        case FACT_TABLES.EVENTS: {
            const event = person.events?.find(e => e.Id === factId);
            if (!event) return null;
            return subject(person, { ...base, fact: { kind: factKindForEvent(event.Type), date: event.Date, place: event.Place } }, nowYear);
        }
        case FACT_TABLES.FAMILY_MARRIAGE:
        case FACT_TABLES.FAMILIES: {
            const spouse = person.spouses?.find(s => s.family.Id === factId);
            if (!spouse) return null;
            const marriage = { date: spouse.family.MarriageDate, spouse: spouse.person };
            return subject(person, { ...base, fact: { kind: 'marriage', date: marriage.date, place: spouse.family.MarriagePlace, marriage } }, nowYear);
        }
    }
    return null;
}

/**
 * A fact on the family page. The search is about the wife, under her maiden
 * surname, with her husband as the spouse; a couple with no woman takes the
 * first partner. Returns null when the family has no partner.
 */
export function familyResearchSubject(
    detail: {
        family: SubjectFamily;
        husband?: SubjectPerson | null;
        wife?: SubjectPerson | null;
        events?: SubjectEvent[];
    },
    factTable: string,
    factId: number,
    nowYear: number,
): ResearchSubject | null {
    const partners = [detail.husband, detail.wife].filter((p): p is SubjectPerson => p != null);
    const principal = partners.find(p => (p.Sex ?? '').toUpperCase() === 'F') ?? partners[0];
    if (!principal) return null;
    const spouse = partners.find(p => p !== principal) ?? null;
    const marriage = { date: detail.family.MarriageDate, spouse };
    const base = { marriages: [marriage], nameVariants: [] };
    switch (factTable) {
        case FACT_TABLES.FAMILY_MARRIAGE:
        case FACT_TABLES.FAMILIES:
            return subject(principal, { ...base, fact: { kind: 'marriage', date: marriage.date, place: detail.family.MarriagePlace, marriage } }, nowYear);
        case FACT_TABLES.EVENTS: {
            const event = detail.events?.find(e => e.Id === factId);
            if (!event) return null;
            const kind = factKindForEvent(event.Type);
            return subject(principal, {
                ...base,
                fact: { kind, date: event.Date, place: event.Place, ...(kind === 'marriage' ? { marriage: { date: event.Date, spouse } } : {}) },
            }, nowYear);
        }
    }
    return null;
}
