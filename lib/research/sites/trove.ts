import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'trove',
    name: 'Trove',
    repository: { name: 'National Library of Australia', website: 'https://www.nla.gov.au' },
    factKinds: ['marriage', 'immigration', 'death', 'burial'],
    regions: ['AU'],
    status: 'observed',
    verified: '2026-10-04',
    docs: 'https://trove.nla.gov.au/search/category/newspapers',
    requires: ['fullName'],
    search: {
        url: 'https://trove.nla.gov.au/search/category/newspapers',
        params: [
            { param: 'keyword', value: 'fullNamePhrase' },
        ],
    },
    prefill: { type: 'Newspaper' },
});
