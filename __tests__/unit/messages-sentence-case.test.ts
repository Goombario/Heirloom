import { describe, it, expect } from 'vitest';
import en from '@/messages/en.json';

/**
 * COPY-1 (#705): UI copy is sentence case (design-system.md, Voice). This
 * flags a message value where a word after the first, within one sentence or
 * clause, is capitalized: "Save Changes", "Audit Log". Proper nouns and
 * product names are allowed by word; the handful of values that are examples
 * or name something verbatim are allowed by key.
 */
const PROPER_NOUNS = new Set([
    // Products, services, formats
    'Heirloom', 'GEDCOM', 'Google', 'Drive', 'Excel', 'OpenStreetMap', 'Photon', 'ScotlandsPeople',
    // Keys
    'Esc', 'Enter',
    // Page names referenced in running text ("from the Library", "in Options")
    'Library', 'Options',
    // Countries and institutions the record sites name (#1026)
    'England', 'Wales', 'Congress', 'Australia', 'Canadian', 'Nova', 'Scotia', 'Dutch', 'Belgian',
    // Example places (#1185: "like Lemberg for Lviv")
    'Lemberg', 'Lviv',
    // Months (dates in examples)
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]);

const ALLOWED_KEYS = new Set([
    // Example values inside placeholders: people, places and record titles.
    'people.search_placeholder',
    'library.field_title_placeholder',
    'library.field_date_placeholder',
    'library.field_place_placeholder',
    'library.ph_title',
    'library.ph_title_short',
    'library.ph_publication',
    'options.quoted_show',
    'options.quoted_exclude',
    'treeSidebar.place_placeholder',
    // The phone case page's hints name its All evidence page (#135).
    'caseResearch.add_note_hint',
    'caseResearch.drop_lead_hint',
    // A record site's publisher, by its own name (#1026).
    'research.sites.trove.note',
    // "New Zealand": "New" is too common to allow as a word.
    'research.sites.paperspast.coverage',
    'research.sites.paperspast.note',
    // "First World War", and the name of the site's own Genealogy filter.
    'research.sites.lac.coverage',
    'research.sites.lac.note',
    // Names the Data checks page in running text (#833).
    'dataChecks.open_in_data_checks',
    // Proper names: time-zone groups and cities, and UTC's official name.
    'options.tz_group_asia_pacific',
    'options.tz_utc',
    'options.tz_city_mexico_city',
    // Spreadsheet sheet and column names, quoted verbatim.
    'spreadsheetImport.help_dropdowns',
    // A tab name quoted verbatim.
    'shareTree.empty_body',
    // Names the "Keep … as another name" checkbox verbatim (#1185).
    'places.check_merge',
]);

function* entries(node: unknown, path = ''): Generator<[string, string]> {
    if (typeof node === 'string') yield [path, node];
    else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) yield* entries(value, path ? `${path}.${key}` : key);
    }
}

/** Capitalized non-initial words in any clause of `value`, ignoring ICU arguments and tags. */
function titleCaseWords(value: string): string[] {
    const text = value
        .replace(/\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, ' ')
        .replace(/<[^>]+>/g, ' ');
    for (const clause of text.split(/[.!?:;—–·()"“”«»\n]|\s-\s/)) {
        const words = clause.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
        const caps = words
            .slice(1)
            .map((w) => w.replace(/['’]s$/, ''))
            .filter((w) => /^[A-Z]/.test(w) && w !== w.toUpperCase() && !PROPER_NOUNS.has(w));
        if (caps.length > 0) return caps;
    }
    return [];
}

describe('en.json sentence case (#705)', () => {
    it('has no multi-word Title Case values', () => {
        const offenders = [...entries(en)]
            .filter(([key]) => !ALLOWED_KEYS.has(key))
            .map(([key, value]) => [key, value, titleCaseWords(value)] as const)
            .filter(([, , caps]) => caps.length > 0)
            .map(([key, value]) => `${key}: ${value}`);
        expect(offenders).toEqual([]);
    });

    it('flags Title Case and passes sentence case', () => {
        expect(titleCaseWords('Save Changes')).toEqual(['Changes']);
        expect(titleCaseWords('Save changes')).toEqual([]);
        expect(titleCaseWords('Back up to Drive')).toEqual([]);
        expect(titleCaseWords('Confirm {count, plural, one {# Match} other {# Matches}}')).toEqual([]);
    });

    it('keeps every allowed key present, so the list cannot rot', () => {
        const keys = new Set([...entries(en)].map(([key]) => key));
        for (const key of ALLOWED_KEYS) expect(keys.has(key), key).toBe(true);
    });
});
