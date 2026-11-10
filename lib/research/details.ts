/**
 * The search tab's details box: the chips a person edits, removes and adds
 * back, and the query they make (#1017 section 1; #1028). The query builder
 * proposes the details; this turns the person's edits into the query every
 * site link is built from.
 *
 * Pure: no DB, no DOM.
 */

import type { ResearchQuery, YearRange } from '@/lib/research/fact-query';
import { parsePlace } from '@/lib/research/places';

export type DetailId = 'given' | 'surname' | 'years' | 'place' | 'spouse' | 'sex';

/** The details as the chip editors hold them: plain text, so a half-typed year stays as typed. */
export interface DetailEdits {
    given: string;
    surname: string;
    yearFrom: string;
    yearTo: string;
    place: string;
    spouseGiven: string;
    spouseSurname: string;
    sex: 'F' | 'M' | '';
    /** Details left out with ×; each comes back with its value from a dashed chip. */
    dropped: DetailId[];
}

/** The chips a query shows: Spouse only for a marriage or when the builder found one. */
export function detailIds(base: ResearchQuery): DetailId[] {
    const ids: DetailId[] = ['given', 'surname', 'years', 'place'];
    if (base.kind === 'marriage' || base.spouse) ids.push('spouse');
    ids.push('sex');
    return ids;
}

export function initialEdits(base: ResearchQuery): DetailEdits {
    return {
        given: base.given,
        surname: base.surname,
        yearFrom: base.years ? String(base.years.from) : '',
        yearTo: base.years ? String(base.years.to) : '',
        place: base.place?.text ?? '',
        spouseGiven: base.spouse?.given ?? '',
        spouseSurname: base.spouse?.surname ?? '',
        sex: base.sex ?? '',
        dropped: [],
    };
}

const YEAR = /^\d{3,4}$/;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The edited years. One year searches that year alone, and a reversed range
 * is put the right way round. A range the person hasn't changed keeps the
 * builder's open-ended mark, so `BEF 1900` stays Thin until the years are edited.
 */
function editedYears(base: YearRange | null, from: string, to: string): YearRange | null {
    const a = YEAR.test(from.trim()) ? Number(from.trim()) : null;
    const b = YEAR.test(to.trim()) ? Number(to.trim()) : null;
    if (a === null && b === null) return null;
    const lo = Math.min(a ?? b!, b ?? a!);
    const hi = Math.max(a ?? b!, b ?? a!);
    const untouched = base !== null && base.from === lo && base.to === hi;
    return { from: lo, to: hi, openEnded: untouched && base.openEnded };
}

/** The value a chip shows, or '' when the detail is empty. */
export function detailValue(edits: DetailEdits, id: DetailId): string {
    switch (id) {
        case 'given': return clean(edits.given);
        case 'surname': return clean(edits.surname);
        case 'years': {
            const years = editedYears(null, edits.yearFrom, edits.yearTo);
            if (!years) return '';
            return years.from === years.to ? String(years.from) : `${years.from}–${years.to}`;
        }
        case 'place': return clean(edits.place);
        case 'spouse': return clean(`${edits.spouseGiven} ${edits.spouseSurname}`);
        case 'sex': return edits.sex;
    }
}

/** The query the site links are built from: the edits, less the details left out. */
export function editedQuery(base: ResearchQuery, edits: DetailEdits): ResearchQuery {
    const out = (id: DetailId) => edits.dropped.includes(id);
    const spouseGiven = clean(edits.spouseGiven);
    const spouseSurname = clean(edits.spouseSurname);
    return {
        ...base,
        given: out('given') ? '' : clean(edits.given),
        surname: out('surname') ? '' : clean(edits.surname),
        years: out('years') ? null : editedYears(base.years, edits.yearFrom, edits.yearTo),
        // An unchanged place keeps the builder's parse, which may carry a country
        // found through the gazetteer (#1030) that the text alone can't.
        place: out('place') ? null : clean(edits.place) === base.place?.text ? base.place : parsePlace(edits.place),
        spouse: out('spouse') || (!spouseGiven && !spouseSurname) ? null : { given: spouseGiven, surname: spouseSurname },
        sex: out('sex') || !edits.sex ? null : edits.sex,
    };
}
