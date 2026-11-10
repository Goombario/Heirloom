import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'freecen',
    name: 'FreeCEN',
    repository: { name: 'FreeCEN', website: 'https://www.freecen.org.uk' },
    factKinds: ['census', 'residence'],
    regions: ['GB-ENG', 'GB-WLS', 'GB-SCT'],
    status: 'form',
    verified: '2026-10-04',
    docs: 'https://www.freecen.org.uk/search_queries/new',
    requires: ['surname'],
    years: { min: 1841, max: 1911 },
    search: {
        kind: 'form',
        url: 'https://www.freecen.org.uk/search_queries/new',
        fields: [
            { label: 'surname', value: 'surname' },
            { label: 'given_names', value: 'givenFirst' },
            { label: 'year', value: 'event.yearMid' },
            { label: 'county', value: 'event.county' },
            { label: 'birth_year', value: 'birth.yearRange' },
        ],
    },
    prefill: { type: 'Census' },
});
