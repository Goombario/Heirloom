import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'paperspast',
    name: 'Papers Past',
    repository: { name: 'National Library of New Zealand', website: 'https://natlib.govt.nz' },
    factKinds: ['marriage', 'immigration', 'death', 'burial'],
    regions: ['NZ'],
    status: 'observed',
    verified: '2026-10-04',
    docs: 'https://paperspast.natlib.govt.nz/newspapers',
    requires: ['fullName'],
    years: { min: 1839 },
    search: {
        url: 'https://paperspast.natlib.govt.nz/newspapers',
        params: [
            { param: 'query', value: 'fullNamePhrase' },
            // Dates as DD-MM-YYYY.
            { param: 'start_date', value: 'event.yearFrom', transform: { name: 'format', template: '01-01-{value}' } },
            { param: 'end_date', value: 'event.yearTo', transform: { name: 'format', template: '31-12-{value}' } },
        ],
    },
    prefill: { type: 'Newspaper' },
});
