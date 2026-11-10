import { describe, expect, it } from 'vitest';
import { buildResearchQuery, type FactKind, type ResearchQuery } from '@/lib/research/fact-query';
import { detailIds, detailValue, editedQuery, initialEdits } from '@/lib/research/details';
import { parsePlace } from '@/lib/research/places';

function query(kind: FactKind = 'death', date = '14 FEB 1931'): ResearchQuery {
    return buildResearchQuery({
        fact: { kind, date, place: 'Buffalo, Erie, New York, USA' },
        person: { FirstName: 'Edith May', LastName: 'Hollis', Sex: 'F', BirthDate: 'ABT 1868', BirthPlace: null, DeathDate: '14 FEB 1931' },
        marriages: [{ date: '1890', spouse: { FirstName: 'Walter', LastName: 'Ashby' } }],
        nameVariants: [{ Type: 'Married', Name: 'Edith Ashby', FromDate: '1890' }],
    });
}

describe('detailIds', () => {
    it('shows Spouse for a marriage or when the builder found one', () => {
        expect(detailIds(query('death'))).toEqual(['given', 'surname', 'years', 'place', 'spouse', 'sex']);
        expect(detailIds(query('birth'))).toEqual(['given', 'surname', 'years', 'place', 'sex']);
    });
});

describe('editedQuery', () => {
    it('keeps a country found through the gazetteer until the place is edited (#1030)', () => {
        const base = { ...query(), place: parsePlace('Maidstone, Kent', ['England', 'Kent']) };
        expect(editedQuery(base, initialEdits(base)).place?.regions).toEqual(['GB-ENG']);
        expect(editedQuery(base, { ...initialEdits(base), place: 'Maidstone, Kent ' }).place?.regions).toEqual(['GB-ENG']);
        expect(editedQuery(base, { ...initialEdits(base), place: 'Maidstone' }).place?.regions).toEqual([]);
    });

    it('is the builder query while nothing is edited', () => {
        const base = query();
        expect(editedQuery(base, initialEdits(base))).toEqual(base);
    });

    it('leaves out dropped details and brings them back with their values', () => {
        const base = query();
        const edits = initialEdits(base);
        const dropped = editedQuery(base, { ...edits, dropped: ['given', 'years', 'place', 'spouse', 'sex'] });
        expect(dropped).toMatchObject({ given: '', years: null, place: null, spouse: null, sex: null, surname: 'Ashby' });
        expect(editedQuery(base, { ...edits, dropped: [] })).toEqual(base);
    });

    it('reads one year as that year, and puts a reversed range the right way round', () => {
        const base = query();
        expect(editedQuery(base, { ...initialEdits(base), yearFrom: '1935', yearTo: '' }).years).toEqual({ from: 1935, to: 1935, openEnded: false });
        expect(editedQuery(base, { ...initialEdits(base), yearFrom: '1935', yearTo: '1930' }).years).toEqual({ from: 1930, to: 1935, openEnded: false });
        expect(editedQuery(base, { ...initialEdits(base), yearFrom: '19', yearTo: 'x' }).years).toBeNull();
    });

    it('keeps an open-ended range open until its years are edited', () => {
        const base = query('death', 'BEF 1931');
        expect(base.years).toEqual({ from: 1921, to: 1931, openEnded: true });
        expect(editedQuery(base, initialEdits(base)).years?.openEnded).toBe(true);
        expect(editedQuery(base, { ...initialEdits(base), yearFrom: '1925' }).years).toEqual({ from: 1925, to: 1931, openEnded: false });
    });

    it('parses an edited place for its region', () => {
        const base = query();
        const edited = editedQuery(base, { ...initialEdits(base), place: 'Maidstone, Kent, England' });
        expect(edited.place?.country).toBe('England');
        expect(edited.place?.regions).toContain('GB-ENG');
    });

    it('drops the spouse when both names are cleared, and the sex when unset', () => {
        const base = query();
        const edited = editedQuery(base, { ...initialEdits(base), spouseGiven: ' ', spouseSurname: '', sex: '' });
        expect(edited.spouse).toBeNull();
        expect(edited.sex).toBeNull();
    });
});

describe('detailValue', () => {
    it('shows each chip as typed, and the years as a range', () => {
        const edits = initialEdits(query());
        expect(detailValue(edits, 'years')).toBe('1930–1932');
        expect(detailValue(edits, 'spouse')).toBe('Walter Ashby');
        expect(detailValue({ ...edits, yearTo: '', yearFrom: '1930' }, 'years')).toBe('1930');
        expect(detailValue({ ...edits, given: '  Edith   May ' }, 'given')).toBe('Edith May');
    });
});
