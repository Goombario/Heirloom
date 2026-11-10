import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'freebmd',
    name: 'FreeBMD',
    repository: { name: 'FreeBMD', website: 'https://www.freebmd.org.uk' },
    factKinds: ['birth', 'marriage', 'death'],
    regions: ['GB-ENG', 'GB-WLS'],
    status: 'form',
    verified: '2026-10-04',
    docs: 'https://www.freebmd.org.uk/search-help.shtml',
    requires: ['surname'],
    years: { min: 1837 },
    search: {
        kind: 'form',
        url: 'https://www.freebmd.org.uk/cgi/search.pl',
        fields: [
            // The site's own option labels.
            { label: 'type', const: 'Births', kinds: ['birth'] },
            { label: 'type', const: 'Marriages', kinds: ['marriage'] },
            { label: 'type', const: 'Deaths', kinds: ['death'] },
            { label: 'surname', value: 'surname', transform: { name: 'upper' } },
            { label: 'given_names', value: 'givenFirst' },
            { label: 'spouse_surname', value: 'spouse.surname', kinds: ['marriage'], transform: { name: 'upper' } },
            { label: 'start_year', value: 'event.yearFrom', transform: { name: 'clampYear', min: 1837 } },
            { label: 'end_year', value: 'event.yearTo' },
            { label: 'district', value: 'event.locality' },
            { label: 'county', value: 'event.county' },
        ],
    },
    // FreeBMD transcribes only the GRO indexes, so the index names the source.
    prefill: {
        title: {
            birth: 'England and Wales Civil Registration Birth Index',
            marriage: 'England and Wales Civil Registration Marriage Index',
            death: 'England and Wales Civil Registration Death Index',
        },
        type: 'Vital',
    },
});
