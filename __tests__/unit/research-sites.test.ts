import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildResearchQuery, FACT_KINDS, type FactKind, type ResearchQuery } from '@/lib/research/fact-query';
import { prefillType, siteSearch, sitesFor } from '@/lib/research/links';
import { QUERY_VALUE_KEYS, queryValue } from '@/lib/research/query';
import { COUNTRIES } from '@/lib/research/regions';
import type { SiteDefinition, SiteParam } from '@/lib/research/site';
import { SITES } from '@/lib/research/sites';
import { applyTransforms, TRANSFORM_NAMES, type Transform } from '@/lib/research/transforms';

/**
 * The record-site registry (#1026). Every site file is data; this checks each
 * one's shape, and snapshots each site's search for a fixed set of facts, so a
 * mapping change shows up as a readable diff. `docs/research-sites.md` says
 * how to add a site and update the snapshots.
 */

const LOCALES = ['en', 'fr', 'ru'] as const;
const catalogs = LOCALES.map(l => JSON.parse(readFileSync(join(__dirname, '../../messages', `${l}.json`), 'utf8')));
const REGION_CODES = new Set(COUNTRIES.flatMap(c => [...c.regions, ...Object.keys(c.subdivisions ?? {})]));
const SOURCE_TYPES = ['Census', 'Vital', 'Church', 'Newspaper', 'Oral', 'Document', 'Photo', 'Other'];

function specsOf(site: SiteDefinition): (SiteParam | (Omit<SiteParam, 'param'> & { label: string }))[] {
    const main = site.search.kind === 'form' ? site.search.fields : site.search.params;
    return [...main, ...(site.alternates ?? []).flatMap(a => a.params)];
}

describe('the site registry (#1026)', () => {
    it('has sites, each with a unique lowercase id', () => {
        expect(SITES.length).toBeGreaterThan(0);
        const ids = SITES.map(s => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
    });

    describe.each(SITES.map(s => [s.id, s] as const))('%s', (_id, site) => {
        it('names known fact kinds and region codes', () => {
            expect(site.factKinds.length).toBeGreaterThan(0);
            for (const kind of site.factKinds) expect(FACT_KINDS).toContain(kind);
            for (const region of site.regions ?? []) expect(REGION_CODES).toContain(region);
            if (site.regions) expect(site.regions.length).toBeGreaterThan(0);
        });

        it('uses https for its search, repository website and docs', () => {
            for (const url of [site.search.url, site.repository.website, site.docs]) {
                expect(new URL(url).protocol).toBe('https:');
            }
            expect(site.repository.name.trim()).not.toBe('');
        });

        it('records when its link was checked, and a status that fits its search', () => {
            expect(site.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(Number.isNaN(Date.parse(site.verified))).toBe(false);
            expect(site.search.kind === 'form').toBe(site.status === 'form');
        });

        it('maps only known value keys, kinds and transforms', () => {
            for (const spec of specsOf(site)) {
                expect((spec.value === undefined) !== (spec.const === undefined)).toBe(true);
                const keys = Array.isArray(spec.value) ? spec.value : spec.value ? [spec.value] : [];
                for (const key of [...keys, ...(spec.when?.has ?? [])]) expect(QUERY_VALUE_KEYS).toContain(key);
                for (const kind of spec.kinds ?? []) expect(site.factKinds).toContain(kind);
                const transforms = Array.isArray(spec.transform) ? spec.transform : spec.transform ? [spec.transform] : [];
                for (const t of transforms) expect(TRANSFORM_NAMES).toContain(t.name);
            }
            for (const alt of site.alternates ?? []) expect(alt.params.length).toBeGreaterThan(0);
        });

        it('sends each parameter at most once for any fact kind', () => {
            if (site.search.kind === 'form') return;
            for (const kind of site.factKinds) {
                const applying = site.search.params
                    .filter(p => !p.kinds || p.kinds.includes(kind))
                    .map(p => `${p.param} ${JSON.stringify(p.when ?? {})}`);
                expect(new Set(applying).size, `${kind}: ${applying.join(', ')}`).toBe(applying.length);
            }
        });

        it('prefills only known source types, for its own fact kinds', () => {
            for (const kind of Object.keys(site.prefill?.title ?? {})) expect(site.factKinds).toContain(kind);
            for (const kind of site.factKinds) {
                const type = prefillType(site, kind);
                if (type) expect(SOURCE_TYPES).toContain(type);
            }
        });

        it('has its coverage, searches and note in every locale', () => {
            for (const catalog of catalogs) {
                const messages = catalog.research.sites[site.id];
                expect(Object.keys(messages ?? {}).sort()).toEqual(['coverage', 'note', 'searches']);
            }
        });
    });

    it('has a message for every requirement reason and form field label', () => {
        const reasons = ['needs_surname', 'needs_name', 'needs_full_name', 'needs_sex', 'starts_in', 'ends_in'];
        const labels = [...new Set(SITES.flatMap(s => s.search.kind === 'form' ? s.search.fields.map(f => f.label) : []))];
        for (const catalog of catalogs) {
            for (const reason of reasons) expect(catalog.research.reasons[reason]).toBeTypeOf('string');
            for (const label of labels) expect(catalog.research.fields[label]).toBeTypeOf('string');
        }
    });
});

describe('transforms (#1026)', () => {
    const t = (value: string, transform: Transform | Transform[]) => applyTransforms(value, transform);

    it('applies each named transform', () => {
        expect(t('Hollis', { name: 'upper' })).toBe('HOLLIS');
        expect(t('1930', { name: 'isoYearStart' })).toBe('1930-01-01');
        expect(t('1932', { name: 'isoYearEnd' })).toBe('1932-12-31');
        expect(t('1975', { name: 'clampYear', max: 1963 })).toBe('1963');
        expect(t('1820', { name: 'clampYear', min: 1837 })).toBe('1837');
        expect(t('4', { name: 'roundToSteps', steps: [1, 3, 5, 10, 25] })).toBe('5');
        expect(t('40', { name: 'roundToSteps', steps: [1, 3, 5, 10, 25] })).toBe('25');
        expect(t('Walter Ashby', { name: 'format', template: 'Mrs. {value}' })).toBe('Mrs. Walter Ashby');
        expect(t('county Cork', { name: 'stripPrefix', prefixes: ['County '] })).toBe('Cork');
        expect(t('Cork', { name: 'stripPrefix', prefixes: ['County '] })).toBe('Cork');
    });

    it('chains transforms in order, and leaves an empty value empty', () => {
        expect(t('1975', [{ name: 'clampYear', max: 1963 }, { name: 'isoYearEnd' }])).toBe('1963-12-31');
        expect(t('', { name: 'format', template: 'Mrs. {value}' })).toBe('');
    });
});

describe('queryValue (#1026)', () => {
    const q: ResearchQuery = {
        kind: 'death', given: 'Edith May', surname: 'Ashby', altSurname: 'Hollis', sex: 'F',
        years: { from: 1930, to: 1932, openEnded: false },
        place: { text: 'Buffalo, Erie, New York, USA', locality: 'Buffalo', county: 'Erie', state: 'New York', country: 'USA', regions: ['US'] },
        spouse: { given: 'Walter James', surname: 'Ashby' },
        birth: { from: 1863, to: 1873, openEnded: false },
        death: null,
    };

    it('reads names, years, place and spouse', () => {
        const values = Object.fromEntries(QUERY_VALUE_KEYS.map(k => [k, queryValue(q, k)]));
        expect(values).toMatchObject({
            given: 'Edith May', givenFirst: 'Edith', givenMiddle: 'May', surname: 'Ashby',
            fullName: 'Edith May Ashby', fullNamePhrase: '"Edith Ashby"', sex: 'F',
            'event.yearFrom': '1930', 'event.yearTo': '1932', 'event.yearMid': '1931', 'event.yearHalfSpan': '1',
            'event.yearRange': '1930-1932', 'event.decade': '1930-1939',
            'event.place': 'Buffalo, Erie, New York, USA', 'event.locality': 'Buffalo', 'event.county': 'Erie',
            'event.state': 'New York', 'event.country': 'USA',
            'birth.yearMid': '1868', 'birth.yearHalfSpan': '5', 'death.yearFrom': '',
            'spouse.given': 'Walter James', 'spouse.givenFirst': 'Walter', 'spouse.surname': 'Ashby',
        });
    });

    it('leaves out a decade the range crosses, and a phrase without a given name', () => {
        expect(queryValue({ ...q, years: { from: 1863, to: 1873, openEnded: false } }, 'event.decade')).toBe('');
        expect(queryValue({ ...q, given: '' }, 'fullNamePhrase')).toBe('');
        expect(queryValue({ ...q, given: '' }, 'fullName')).toBe('Ashby');
    });

    it('ignores stray spaces left by an edit', () => {
        const edited = { ...q, given: '  Edith   May ', surname: ' Ashby ' };
        expect(queryValue(edited, 'givenFirst')).toBe('Edith');
        expect(queryValue(edited, 'givenMiddle')).toBe('May');
        expect(queryValue(edited, 'fullNamePhrase')).toBe('"Edith Ashby"');
        const blank = { ...q, given: ' ', surname: ' ' };
        expect(siteSearch(SITES.find(s => s.id === 'familysearch')!, blank).blocked).toEqual({ key: 'needs_name' });
    });
});

/** A fixed set of facts, one or more per region and kind, for the URL snapshots. */
type Fixture = { kind: FactKind; date: string | null; place: string | null; person?: 'edith' | 'john' | 'noGiven' };

const PEOPLE = {
    edith: { FirstName: 'Edith May', LastName: 'Hollis', Sex: 'F', BirthDate: 'ABT 1868', BirthPlace: 'Maidstone, Kent, England', DeathDate: '14 FEB 1931' },
    john: { FirstName: 'John', LastName: 'MacLeod', Sex: 'M', BirthDate: '1876', BirthPlace: 'Stornoway, Ross and Cromarty, Scotland', DeathDate: null },
    noGiven: { FirstName: null, LastName: 'Hollis', Sex: null, BirthDate: null, BirthPlace: null, DeathDate: null },
};
const EDITH_MARRIAGE = { date: '3 JUN 1890', spouse: { FirstName: 'Walter James', LastName: 'Ashby' } };
const JOHN_MARRIAGE = { date: '1912', spouse: { FirstName: 'Mary', LastName: 'Fraser' } };

const FIXTURES: Record<string, Fixture> = {
    'death in Buffalo, USA, under a married name': { kind: 'death', date: '14 FEB 1931', place: 'Buffalo, Erie, New York, USA' },
    'birth about 1868 in Kent, England': { kind: 'birth', date: 'ABT 1868', place: 'Maidstone, Kent, England' },
    'marriage in 1890 in Kent, England': { kind: 'marriage', date: '3 JUN 1890', place: "St Mary's Church, Maidstone, Kent, England" },
    'census in 1881 in Kent, England': { kind: 'census', date: '1881', place: 'Maidstone, Kent, England' },
    'residence in 1921 in Scotland, after the census years': { kind: 'residence', date: '1921', place: 'Stornoway, Ross and Cromarty, Scotland', person: 'john' },
    'burial before 1900 in Sydney, Australia': { kind: 'burial', date: 'BEF 1900', place: 'Rookwood Cemetery, Sydney, New South Wales, Australia', person: 'john' },
    'death in 1975 in Boston, USA, after Chronicling America': { kind: 'death', date: '1975', place: 'Boston, Suffolk, Massachusetts, USA', person: 'john' },
    'immigration in 1905 to Halifax, Nova Scotia': { kind: 'immigration', date: '1905', place: 'Halifax, Nova Scotia, Canada', person: 'john' },
    'marriage in 1912 in Halifax, Nova Scotia': { kind: 'marriage', date: '1912', place: 'Halifax, Halifax, Nova Scotia, Canada', person: 'john' },
    'death in 1917 in Halifax, Nova Scotia': { kind: 'death', date: '6 DEC 1917', place: 'Halifax, Nova Scotia, Canada', person: 'john' },
    'census in 1911 in Toronto, Ontario': { kind: 'census', date: '1911', place: 'Toronto, York, Ontario, Canada', person: 'john' },
    'birth in 1880 in Cork, Ireland': { kind: 'birth', date: '1880', place: 'Cork, County Cork, Ireland', person: 'john' },
    'death in 1890 in Leiden, Netherlands': { kind: 'death', date: '1890', place: 'Leiden, Zuid-Holland, Netherlands' },
    'burial in 1902 in Wellington, New Zealand, under a married name': { kind: 'burial', date: '1902', place: 'Wellington, New Zealand' },
    'occupation with no date in Dublin, Ireland': { kind: 'other', date: null, place: 'Dublin, Ireland' },
    'name with no given name': { kind: 'name', date: null, place: null, person: 'noGiven' },
};

function fixtureQuery(f: Fixture): ResearchQuery {
    const john = f.person === 'john';
    const marriage = john ? JOHN_MARRIAGE : EDITH_MARRIAGE;
    return buildResearchQuery({
        fact: { kind: f.kind, date: f.date, place: f.place, marriage: f.kind === 'marriage' ? marriage : undefined },
        person: PEOPLE[f.person ?? 'edith'],
        marriages: f.person === 'noGiven' ? [] : [marriage],
        nameVariants: john ? [] : [{ Type: 'Married', Name: 'Edith May Ashby', FromDate: null }],
    });
}

/** Each offered site's search, one line each, with its alternates and form values indented below. */
function searches(q: ResearchQuery): string[] {
    return sitesFor(q).flatMap(site => {
        const s = siteSearch(site, q);
        if (s.blocked) return [`${site.id} blocked: ${s.blocked.key}${'year' in s.blocked ? ` ${s.blocked.year}` : ''}`];
        return [
            `${site.id} ${s.url}`,
            ...s.fields.map(f => `  ${f.label}: ${f.value}`),
            ...s.alternates.map(a => `  also ${a.label}: ${a.url}`),
        ];
    });
}

describe('site searches for fixture facts (#1026)', () => {
    it.each(Object.keys(FIXTURES))('%s', name => {
        expect(searches(fixtureQuery(FIXTURES[name]))).toMatchSnapshot();
    });

    it('offers a regional site only for a place in its region', () => {
        const q = fixtureQuery(FIXTURES['death in Buffalo, USA, under a married name']);
        expect(sitesFor(q).map(s => s.id)).toContain('chroniclingamerica');
        expect(sitesFor({ ...q, place: null }).map(s => s.id)).not.toContain('chroniclingamerica');
    });

    it('offers every site for at least one fixture, so each has a snapshot', () => {
        const offered = new Set(Object.values(FIXTURES).flatMap(f => sitesFor(fixtureQuery(f)).map(s => s.id)));
        expect(SITES.map(s => s.id).filter(id => !offered.has(id))).toEqual([]);
    });

    it('sends the person as the bride or the groom by sex', () => {
        const marriage = { date: '1912', spouse: { FirstName: 'John', LastName: 'MacLeod' } };
        const q = buildResearchQuery({
            fact: { kind: 'marriage', date: '1912', place: 'Halifax, Nova Scotia, Canada', marriage },
            person: { ...PEOPLE.edith, LastName: 'Fraser' },
            marriages: [marriage],
            nameVariants: [],
        });
        const site = SITES.find(s => s.id === 'novascotia')!;
        expect(siteSearch(site, q).url).toContain('BFirst=Edith&BLast=Fraser&GFirst=John&GLast=MacLeod');
        expect(siteSearch(site, { ...q, sex: null }).blocked).toEqual({ key: 'needs_sex' });
    });

    it('offers only the catch-all sites for any other event', () => {
        const q = fixtureQuery(FIXTURES['occupation with no date in Dublin, Ireland']);
        expect(sitesFor(q).map(s => s.id)).toEqual(['familysearch', 'internetarchive']);
    });
});
