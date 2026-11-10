import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'internetarchive',
    name: 'Internet Archive',
    repository: { name: 'Internet Archive', website: 'https://archive.org' },
    factKinds: ['name', 'birth', 'census', 'residence', 'marriage', 'immigration', 'death', 'other'],
    regions: null,
    status: 'observed',
    verified: '2026-10-04',
    docs: 'https://help.archive.org/help/search-building-powerful-complex-queries/',
    requires: ['fullName'],
    search: {
        url: 'https://archive.org/search',
        params: [
            // Full text: the name as a phrase, plus the town.
            { param: 'query', value: ['fullNamePhrase', 'event.locality'] },
            { param: 'sin', const: 'TXT' },
        ],
    },
});
