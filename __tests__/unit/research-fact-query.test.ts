import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    buildResearchQuery,
    factKindForEvent,
    readiness,
    searchYears,
    type ReadinessReason,
    type ResearchInput,
} from '@/lib/research/fact-query';
import { parsePlace } from '@/lib/research/places';
import { sitesFor } from '@/lib/research/links';

describe('searchYears (#1025)', () => {
    it('searches an exact date ±1 year', () => {
        expect(searchYears('14 FEB 1931')).toEqual({ from: 1930, to: 1932, openEnded: false });
        expect(searchYears('1931-02-14')).toEqual({ from: 1930, to: 1932, openEnded: false });
        expect(searchYears('1931')).toEqual({ from: 1930, to: 1932, openEnded: false });
    });

    it('widens ABT, EST and CAL by ±5', () => {
        expect(searchYears('ABT 1868')).toEqual({ from: 1863, to: 1873, openEnded: false });
        expect(searchYears('EST 1868')).toEqual({ from: 1863, to: 1873, openEnded: false });
        expect(searchYears('CAL 1868')).toEqual({ from: 1863, to: 1873, openEnded: false });
    });

    it('searches BET a AND b from a to b', () => {
        expect(searchYears('BET 1860 AND 1875')).toEqual({ from: 1860, to: 1875, openEnded: false });
        expect(searchYears('FROM 1860 TO 1865')).toEqual({ from: 1860, to: 1865, openEnded: false });
    });

    it('caps BEF and AFT at 10 years and marks them open-ended', () => {
        expect(searchYears('BEF 1900')).toEqual({ from: 1890, to: 1900, openEnded: true });
        expect(searchYears('AFT 1900')).toEqual({ from: 1900, to: 1910, openEnded: true });
    });

    it('sends no year for a date phrase, an empty value or an unreadable date', () => {
        expect(searchYears('(about the time of the flood)')).toBeNull();
        expect(searchYears('')).toBeNull();
        expect(searchYears(null)).toBeNull();
        expect(searchYears('sometime')).toBeNull();
    });

    it('reads an interpreted date as exact', () => {
        expect(searchYears('INT 1850 (from the parish book)')).toEqual({ from: 1849, to: 1851, openEnded: false });
    });
});

describe('factKindForEvent (#1025)', () => {
    it('maps event types to fact kinds as #1017 tables them', () => {
        expect(['CHR', 'BAPM', 'BIRT'].map(factKindForEvent)).toEqual(['birth', 'birth', 'birth']);
        expect(['EMIG', 'NATU', 'IMMI'].map(factKindForEvent)).toEqual(['immigration', 'immigration', 'immigration']);
        expect(factKindForEvent('PROB')).toBe('death');
        expect(factKindForEvent('CENS')).toBe('census');
        expect(factKindForEvent('RESI')).toBe('residence');
        expect(factKindForEvent('BURI')).toBe('burial');
    });

    it('falls back for any other event type', () => {
        expect(factKindForEvent('OCCU')).toBe('other');
        expect(factKindForEvent('GRAD')).toBe('other');
    });
});

describe('parsePlace (#1025)', () => {
    it('splits the parts and takes the last as the country', () => {
        expect(parsePlace('Maidstone, Kent, England')).toEqual({
            text: 'Maidstone, Kent, England', locality: 'Maidstone', county: 'Kent', state: '', country: 'England', regions: ['GB-ENG'],
        });
        expect(parsePlace('Buffalo, Erie, New York, USA')).toEqual({
            text: 'Buffalo, Erie, New York, USA', locality: 'Buffalo', county: 'Erie', state: 'New York', country: 'USA', regions: ['US'],
        });
    });

    it('accepts country aliases', () => {
        for (const us of ['USA', 'U.S.A.', 'United States', 'united states of america', 'US']) {
            expect(parsePlace(`Boston, Massachusetts, ${us}`)?.regions).toEqual(['US']);
        }
    });

    it('gives a UK place both the England and Wales regions and the Scottish one', () => {
        for (const uk of ['UK', 'U.K.', 'United Kingdom', 'Great Britain']) {
            expect(parsePlace(`Leeds, Yorkshire, ${uk}`)?.regions).toEqual(['GB-ENG', 'GB-WLS', 'GB-SCT']);
        }
        expect(parsePlace('Paisley, Renfrewshire, Scotland')?.regions).toEqual(['GB-SCT']);
    });

    it('adds a Canadian province code, by name or abbreviation', () => {
        expect(parsePlace('Halifax, Nova Scotia, Canada')).toMatchObject({ state: 'Nova Scotia', regions: ['CA', 'CA-NS'] });
        expect(parsePlace('Halifax, N.S., Canada')?.regions).toEqual(['CA', 'CA-NS']);
        expect(parsePlace('Kingston, Frontenac, Upper Canada, Canada')).toMatchObject({ county: 'Frontenac', regions: ['CA', 'CA-ON'] });
        expect(parsePlace('Québec, Canada')).toMatchObject({ locality: '', state: 'Québec', regions: ['CA', 'CA-QC'] });
    });

    it('drops a leading cemetery or church name', () => {
        expect(parsePlace('Forest Lawn Cemetery, Buffalo, Erie, New York, USA')?.text).toBe('Buffalo, Erie, New York, USA');
        expect(parsePlace("St Mary's Churchyard, Maidstone, Kent, England")?.locality).toBe('Maidstone');
        // A town whose name starts with "Church" is kept.
        expect(parsePlace('Church Stretton, Shropshire, England')?.locality).toBe('Church Stretton');
    });

    it('gives a place without a known country no regions', () => {
        expect(parsePlace('Maidstone, Kent')).toMatchObject({ country: 'Kent', regions: [] });
        expect(parsePlace('Maidstone')).toEqual({ text: 'Maidstone', locality: 'Maidstone', county: '', state: '', country: '', regions: [] });
        expect(parsePlace('England')).toMatchObject({ locality: '', country: 'England', regions: ['GB-ENG'] });
        expect(parsePlace(' , ')).toBeNull();
        expect(parsePlace(null)).toBeNull();
    });
});

describe('parsePlace through the gazetteer (#1030)', () => {
    const englandChain = ['United Kingdom', 'England', 'Kent', 'Maidstone, Kent'];

    it('takes the country a place is filed under when its text names none', () => {
        const place = parsePlace('Maidstone, Kent', englandChain);
        expect(place).toEqual({ text: 'Maidstone, Kent', locality: 'Maidstone', county: 'Kent', state: '', country: 'England', regions: ['GB-ENG'] });
        // The acceptance case: FreeBMD for the birth and FreeCEN for a census.
        const sites = (kind: 'birth' | 'census', chain: string[]) => sitesFor(buildResearchQuery({
            fact: { kind, date: '1871', place: 'Maidstone, Kent' },
            person: { FirstName: 'Edith', LastName: 'Hollis', Sex: 'F', BirthDate: '1868', BirthPlace: 'Maidstone, Kent', DeathDate: null },
            marriages: [], nameVariants: [],
        }, chain)).map(s => s.id);
        expect(sites('birth', englandChain)).toContain('freebmd');
        expect(sites('census', englandChain)).toContain('freecen');
        expect(sites('birth', [])).not.toContain('freebmd');
        expect(sites('census', [])).not.toContain('freecen');
    });

    it('uses the nearest country, the last comma part of a jurisdiction, and a province on the way', () => {
        expect(parsePlace('Maidstone', ['United Kingdom', 'Kent, England', 'Maidstone'])?.regions).toEqual(['GB-ENG']);
        expect(parsePlace('Halifax', ['Canada', 'Nova Scotia', 'Halifax'])).toMatchObject({ locality: 'Halifax', state: 'Nova Scotia', regions: ['CA', 'CA-NS'] });
        expect(parsePlace('Halifax, Nova Scotia', ['Canada', 'Nova Scotia', 'Halifax, Nova Scotia'])).toMatchObject({ state: 'Nova Scotia', regions: ['CA', 'CA-NS'] });
    });

    it('lets a country in the text win, and falls back to the comma rule outside the gazetteer', () => {
        expect(parsePlace('Leeds, Yorkshire, England', ['Scotland'])?.regions).toEqual(['GB-ENG']);
        expect(parsePlace('Maidstone, Kent', [])).toMatchObject({ country: 'Kent', regions: [] });
        expect(parsePlace('Maidstone, Kent', ['Kent', 'Maidstone, Kent'])).toMatchObject({ country: 'Kent', regions: [] });
    });
});

/** Edith Hollis: born about 1868 in Kent, married Walter Ashby in 1890, died in Buffalo in 1931. */
function edith(overrides: Partial<ResearchInput> = {}): ResearchInput {
    return {
        fact: { kind: 'death', date: '14 FEB 1931', place: 'Buffalo, Erie, New York, USA' },
        person: {
            FirstName: 'Edith May', LastName: 'Hollis', Sex: 'F',
            BirthDate: 'ABT 1868', BirthPlace: 'Maidstone, Kent, England', DeathDate: '14 FEB 1931',
        },
        marriages: [{ date: '3 JUN 1890', spouse: { FirstName: 'Walter James', LastName: 'Ashby' } }],
        nameVariants: [{ Type: 'Married', Name: 'Edith May Ashby', FromDate: null }],
        ...overrides,
    };
}

describe('buildResearchQuery (#1025)', () => {
    it('searches the married surname after the marriage, with the maiden one as the alternative', () => {
        const q = buildResearchQuery(edith());
        expect(q).toMatchObject({
            kind: 'death', given: 'Edith May', surname: 'Ashby', altSurname: 'Hollis', sex: 'F',
            years: { from: 1930, to: 1932, openEnded: false },
            spouse: { given: 'Walter James', surname: 'Ashby' },
            birth: { from: 1863, to: 1873 },
            death: { from: 1930, to: 1932 },
        });
        expect(q.place?.regions).toEqual(['US']);
    });

    it('searches the maiden surname before the marriage, with the married one as the alternative', () => {
        const q = buildResearchQuery(edith({ fact: { kind: 'census', date: '1881', place: 'Maidstone, Kent, England' } }));
        expect(q).toMatchObject({ surname: 'Hollis', altSurname: 'Ashby', spouse: null });
    });

    it('sends no spouse with a census under the married surname', () => {
        const q = buildResearchQuery(edith({ fact: { kind: 'census', date: '1901', place: 'Buffalo, Erie, New York, USA' } }));
        expect(q).toMatchObject({ surname: 'Ashby', altSurname: 'Hollis', spouse: null });
    });

    it('searches a marriage under the maiden surname plus that family’s spouse', () => {
        const marriage = { date: '3 JUN 1890', spouse: { FirstName: 'Walter James', LastName: 'Ashby' } };
        const q = buildResearchQuery(edith({ fact: { kind: 'marriage', date: '3 JUN 1890', place: 'Maidstone, Kent, England', marriage } }));
        expect(q).toMatchObject({ surname: 'Hollis', altSurname: null, spouse: { given: 'Walter James', surname: 'Ashby' } });
    });

    it('uses the birth range and birth place for a Name fact', () => {
        const q = buildResearchQuery(edith({ fact: { kind: 'name', date: null, place: null } }));
        expect(q).toMatchObject({ surname: 'Hollis', years: { from: 1863, to: 1873 } });
        expect(q.place?.locality).toBe('Maidstone');
    });

    describe('with several marriages', () => {
        const twice = edith({
            marriages: [
                // Out of order on purpose: the latest marriage before the fact wins, not the last listed.
                { date: '1902', spouse: { FirstName: 'Henry', LastName: 'Croft' } },
                { date: '3 JUN 1890', spouse: { FirstName: 'Walter James', LastName: 'Ashby' } },
            ],
            nameVariants: [
                { Type: 'Married', Name: 'Edith May Ashby', FromDate: null },
                { Type: 'Married', Name: 'Edith May Croft', FromDate: null },
            ],
        });

        it('takes the latest marriage that starts before the fact, and its married surname', () => {
            const q = buildResearchQuery({ ...twice, fact: { kind: 'immigration', date: '1895', place: null } });
            expect(q).toMatchObject({ surname: 'Ashby', spouse: { given: 'Walter James', surname: 'Ashby' } });
            const later = buildResearchQuery(twice);
            expect(later).toMatchObject({ surname: 'Croft', altSurname: 'Hollis', spouse: { given: 'Henry', surname: 'Croft' } });
        });

        it('takes the last marriage for an undated death', () => {
            const q = buildResearchQuery({ ...twice, fact: { kind: 'burial', date: null, place: null } });
            expect(q).toMatchObject({ surname: 'Croft', spouse: { surname: 'Croft' } });
        });

        it('matches a married name to its marriage by date when the spouse surname differs', () => {
            const q = buildResearchQuery({
                ...twice,
                nameVariants: [
                    { Type: 'Married', Name: 'Edith Ashbey', FromDate: '1890' },
                    { Type: 'Married', Name: 'Edith Crofte', FromDate: '1902' },
                ],
            });
            expect(q.surname).toBe('Crofte');
        });
    });

    it('keeps the maiden surname with no married name variant', () => {
        const q = buildResearchQuery(edith({ nameVariants: [{ Type: 'Nickname', Name: 'Edie', FromDate: null }] }));
        expect(q).toMatchObject({ surname: 'Hollis', altSurname: null, spouse: null });
    });

    it('falls back to the married surname when the maiden one is blank', () => {
        const q = buildResearchQuery(edith({
            person: { ...edith().person, LastName: null },
            fact: { kind: 'birth', date: 'ABT 1868', place: null },
        }));
        expect(q).toMatchObject({ surname: 'Ashby', altSurname: null });
    });

    it('leaves sex out when it is unknown', () => {
        expect(buildResearchQuery(edith({ person: { ...edith().person, Sex: 'U' } })).sex).toBeNull();
    });
});

describe('readiness (#1025)', () => {
    const place = parsePlace('Buffalo, Erie, New York, USA');
    const years = { from: 1930, to: 1932, openEnded: false };
    const full = { given: 'Edith', surname: 'Ashby', years, place };

    it('is Ready with a surname, a given name, a closed range of 10 years or less and a place', () => {
        expect(readiness(full)).toEqual({ level: 'ready', reasons: [] });
        expect(readiness({ ...full, years: { from: 1863, to: 1873, openEnded: false } }).level).toBe('ready');
    });

    it('is Thin, with what’s missing, short of Ready', () => {
        expect(readiness({ ...full, given: '' })).toEqual({ level: 'thin', reasons: ['no_given'] });
        expect(readiness({ ...full, years: null })).toEqual({ level: 'thin', reasons: ['no_year'] });
        expect(readiness({ ...full, place: null })).toEqual({ level: 'thin', reasons: ['no_place'] });
        expect(readiness({ ...full, years: { from: 1860, to: 1875, openEnded: false } })).toEqual({ level: 'thin', reasons: ['wide_range'] });
        expect(readiness({ ...full, given: '', place: null })).toEqual({ level: 'thin', reasons: ['no_given', 'no_place'] });
    });

    it('keeps an open-ended date Thin until the years are edited', () => {
        expect(readiness({ ...full, years: searchYears('BEF 1900') })).toEqual({ level: 'thin', reasons: ['open_ended'] });
        expect(readiness({ ...full, years: { from: 1890, to: 1900, openEnded: false } }).level).toBe('ready');
    });

    it('is Not enough with no surname, or no year and no place', () => {
        expect(readiness({ ...full, surname: ' ' })).toEqual({ level: 'not_enough', reasons: ['no_surname'] });
        expect(readiness({ ...full, years: null, place: null })).toEqual({ level: 'not_enough', reasons: ['no_year_or_place'] });
    });

    it('has a message for every level and reason in every locale', () => {
        const keys: (ReadinessReason | 'ready' | 'thin' | 'not_enough')[] = [
            'ready', 'thin', 'not_enough',
            'no_surname', 'no_year_or_place', 'no_given', 'no_year', 'no_place', 'wide_range', 'open_ended',
        ];
        for (const locale of ['en', 'fr', 'ru']) {
            const catalog = JSON.parse(readFileSync(join(__dirname, '../../messages', `${locale}.json`), 'utf8'));
            expect(Object.keys(catalog.research.readiness).sort()).toEqual([...keys].sort());
        }
    });
});
