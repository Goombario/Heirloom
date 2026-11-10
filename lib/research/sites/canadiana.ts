import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'canadiana',
    name: 'Canadiana',
    repository: { name: 'Canadiana', website: 'https://www.canadiana.ca' },
    factKinds: ['name', 'birth', 'census', 'residence', 'marriage', 'immigration', 'death', 'burial'],
    regions: ['CA'],
    status: 'observed',
    verified: '2026-10-04',
    docs: 'https://www.canadiana.ca/search',
    requires: ['fullName'],
    search: {
        url: 'https://www.canadiana.ca/search',
        params: [
            { param: 'q0.0', value: 'fullNamePhrase' },
        ],
    },
});
