/**
 * The query vocabulary: the named values a site's URL parameters and form
 * fields draw from (#1017 section 3; #1026). A site file names a value by key
 * and never computes one, so every mapping stays data.
 *
 * Pure: no DB, no DOM.
 */

import type { ResearchQuery, YearRange } from '@/lib/research/fact-query';

const RANGE_KEYS = ['yearFrom', 'yearTo', 'yearMid', 'yearHalfSpan', 'yearRange', 'decade'] as const;

export const QUERY_VALUE_KEYS = [
    'given', 'givenFirst', 'givenMiddle', 'surname', 'fullName', 'fullNamePhrase',
    'sex',
    ...RANGE_KEYS.map(k => `event.${k}` as const),
    'event.place', 'event.locality', 'event.county', 'event.state', 'event.country',
    ...RANGE_KEYS.map(k => `birth.${k}` as const),
    ...RANGE_KEYS.map(k => `death.${k}` as const),
    'spouse.given', 'spouse.givenFirst', 'spouse.surname',
] as const;

export type QueryValueKey = (typeof QUERY_VALUE_KEYS)[number];

/** A name's words; the search box's edits can leave stray spaces. */
const words = (s: string) => s.split(/\s+/).filter(Boolean);

function rangeValue(range: YearRange | null, key: string): string {
    if (!range) return '';
    switch (key) {
        case 'yearFrom': return String(range.from);
        case 'yearTo': return String(range.to);
        case 'yearMid': return String(Math.round((range.from + range.to) / 2));
        case 'yearHalfSpan': return String(Math.ceil((range.to - range.from) / 2));
        // "1863-1873", or the one year.
        case 'yearRange': return range.from === range.to ? String(range.from) : `${range.from}-${range.to}`;
        // "1860-1869" when the range falls within one decade.
        case 'decade': {
            const decade = Math.floor(range.from / 10) * 10;
            return Math.floor(range.to / 10) * 10 === decade ? `${decade}-${decade + 9}` : '';
        }
    }
    return '';
}

/**
 * One named value of a query, or '' when the query doesn't have it.
 *
 * - `given` is every given name, `givenFirst` the first and `givenMiddle` the rest.
 * - `fullName` is the given names and surname that are present; `fullNamePhrase`
 *   is `"givenFirst surname"` in quotes, and '' unless both are present.
 * - `sex` is `F` or `M`.
 * - `event.*` is the fact's own years and place; `birth.*` and `death.*` are
 *   the person's birth and death years.
 */
export function queryValue(q: ResearchQuery, key: QueryValueKey): string {
    const [scope, field] = key.includes('.') ? key.split('.') : ['', key];
    switch (scope) {
        case 'event':
            switch (field) {
                case 'place': return q.place?.text ?? '';
                case 'locality':
                case 'county':
                case 'state':
                case 'country': return q.place?.[field] ?? '';
            }
            return rangeValue(q.years, field);
        case 'birth': return rangeValue(q.birth, field);
        case 'death': return rangeValue(q.death, field);
        case 'spouse':
            if (!q.spouse) return '';
            if (field === 'given') return words(q.spouse.given).join(' ');
            if (field === 'givenFirst') return words(q.spouse.given)[0] ?? '';
            return words(q.spouse.surname).join(' ');
    }
    const given = words(q.given);
    const surname = words(q.surname).join(' ');
    switch (field) {
        case 'given': return given.join(' ');
        case 'givenFirst': return given[0] ?? '';
        case 'givenMiddle': return given.slice(1).join(' ');
        case 'surname': return surname;
        case 'fullName': return [...given, surname].filter(Boolean).join(' ');
        case 'fullNamePhrase': return given[0] && surname ? `"${given[0]} ${surname}"` : '';
        case 'sex': return q.sex ?? '';
    }
    return '';
}
