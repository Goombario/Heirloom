import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'laccensus',
    name: 'LAC Census search',
    repository: { name: 'Library and Archives Canada', website: 'https://www.canada.ca/en/library-archives.html' },
    factKinds: ['census', 'residence'],
    regions: ['CA'],
    // The census search has a field per census attribute, but whether its year,
    // province and birth-year values travel in a result URL is still unchecked
    // (#43), so Open goes to the form and the values are copied in.
    status: 'form',
    verified: '2026-10-13',
    docs: 'https://recherche-collection-search.bac-lac.gc.ca/eng/census/index',
    requires: ['surname'],
    // Every census from 1825 to 1931.
    years: { min: 1825, max: 1931 },
    search: {
        kind: 'form',
        url: 'https://recherche-collection-search.bac-lac.gc.ca/eng/census/index',
        fields: [
            // The census years are its checkboxes.
            { label: 'year', value: 'event.yearMid' },
            { label: 'surname', value: 'surname' },
            { label: 'given_names', value: 'givenFirst' },
            { label: 'province', value: 'event.state' },
            { label: 'district', value: 'event.locality' },
            // Its year of birth is a median with a range slider.
            { label: 'birth_year', value: 'birth.yearMid' },
        ],
    },
    prefill: { type: 'Census' },
});
