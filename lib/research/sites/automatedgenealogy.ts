import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'automatedgenealogy',
    name: 'Automated Genealogy',
    repository: { name: 'Automated Genealogy', website: 'https://automatedgenealogy.com' },
    factKinds: ['census', 'residence'],
    regions: ['CA'],
    status: 'form',
    verified: '2026-10-13',
    docs: 'https://automatedgenealogy.com/census/index.jsp?locale=en',
    requires: ['surname'],
    // Indexes for 1851 (New Brunswick), 1852, 1901, 1906 and 1911.
    years: { min: 1851, max: 1911 },
    search: {
        kind: 'form',
        url: 'https://automatedgenealogy.com/',
        // The index takes a surname only; the year and province are its buttons.
        fields: [
            { label: 'year', value: 'event.yearMid' },
            { label: 'surname', value: 'surname' },
            { label: 'province', value: 'event.state' },
        ],
    },
    prefill: { type: 'Census' },
});
