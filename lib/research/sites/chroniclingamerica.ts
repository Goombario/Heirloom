import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'chroniclingamerica',
    name: 'Chronicling America',
    repository: { name: 'Library of Congress', website: 'https://www.loc.gov' },
    factKinds: ['marriage', 'immigration', 'death', 'burial'],
    regions: ['US'],
    status: 'documented',
    verified: '2026-10-13',
    docs: 'https://blogs.loc.gov/headlinesandheroes/2025/01/tips-for-searching-in-chronicling-america/',
    requires: ['fullName'],
    years: { min: 1756, max: 1963 },
    search: {
        url: 'https://www.loc.gov/collections/chronicling-america/',
        params: [
            { param: 'dl', const: 'page' },
            { param: 'searchType', const: 'advanced' },
            { param: 'ops', const: 'PHRASE' },
            { param: 'qs', value: ['givenFirst', 'surname'] },
            { param: 'start_date', value: 'event.yearFrom', transform: [{ name: 'clampYear', min: 1756 }, { name: 'isoYearStart' }] },
            { param: 'end_date', value: 'event.yearTo', transform: [{ name: 'clampYear', max: 1963 }, { name: 'isoYearEnd' }] },
        ],
    },
    // Notices of the period often name a married woman by her husband.
    alternates: [{
        when: { sex: 'F', has: ['spouse.givenFirst', 'spouse.surname'] },
        params: [{ param: 'qs', value: ['spouse.givenFirst', 'spouse.surname'], transform: { name: 'format', template: 'Mrs. {value}' } }],
    }],
    prefill: { type: 'Newspaper' },
});
