import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'openarchives',
    name: 'Open Archives',
    repository: { name: 'Open Archives', website: 'https://www.openarchieven.nl' },
    factKinds: ['name', 'birth', 'census', 'residence', 'marriage', 'death', 'burial'],
    regions: ['NL', 'BE'],
    status: 'documented',
    verified: '2026-10-04',
    docs: 'https://www.openarchieven.nl/api/docs/',
    requires: ['surname'],
    search: {
        url: 'https://www.openarchieven.nl/search.php',
        params: [
            { param: 'lang', const: 'en' },
            // The year range goes inside the name query: "Jan de Vries 1889-1891".
            { param: 'name', value: ['fullName', 'event.yearRange'] },
            { param: 'eventplace', value: 'event.locality' },
        ],
    },
});
