import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'cvwm',
    name: 'Canadian Virtual War Memorial',
    repository: { name: 'Veterans Affairs Canada', website: 'https://www.veterans.gc.ca' },
    factKinds: ['death', 'burial'],
    regions: ['CA'],
    status: 'observed',
    verified: '2026-10-04',
    docs: 'https://www.veterans.gc.ca/en/remembrance/memorials/canadian-virtual-war-memorial',
    requires: ['surname'],
    years: { min: 1884 },
    search: {
        // The memorial's own search form, sent as a GET to its page.
        url: 'https://www.veterans.gc.ca/en/remembrance/memorials/canadian-virtual-war-memorial',
        params: [
            { param: 'field_surname', value: 'surname' },
            { param: 'field_given_names', value: 'givenFirst' },
        ],
    },
});
