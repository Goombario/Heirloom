import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'irishgenealogy',
    name: 'IrishGenealogy.ie',
    repository: { name: 'IrishGenealogy.ie', website: 'https://www.irishgenealogy.ie' },
    factKinds: ['birth', 'marriage', 'death', 'burial'],
    regions: ['IE', 'GB-NIR'],
    // The all-records search, so a birth finds civil births and church baptisms. Its URL
    // fills the form, but a captcha and the terms still need a click before it searches.
    status: 'observed',
    verified: '2026-10-13',
    docs: 'https://www.irishgenealogy.ie/search/',
    requires: ['surname'],
    search: {
        url: 'https://www.irishgenealogy.ie/search/',
        params: [
            { param: 'church-or-civil', const: 'all' },
            { param: 'firstname', value: 'givenFirst' },
            { param: 'lastname', value: 'surname' },
            // Must match a location in its list, which names a county "Co. Cork".
            {
                param: 'location',
                value: 'event.county',
                transform: [{ name: 'stripPrefix', prefixes: ['County ', 'Co. ', 'Co '] }, { name: 'format', template: 'Co. {value}' }],
            },
            { param: 'yearStart', value: 'event.yearFrom' },
            { param: 'yearEnd', value: 'event.yearTo' },
            { param: 'event-birth', const: '1', kinds: ['birth'] },
            { param: 'event-baptism', const: '1', kinds: ['birth'] },
            { param: 'event-marriage', const: '1', kinds: ['marriage'] },
            { param: 'event-death', const: '1', kinds: ['death'] },
            { param: 'event-burial', const: '1', kinds: ['burial'] },
        ],
    },
    // Civil registration for births, marriages and deaths; a burial is a church record.
    prefill: { type: { birth: 'Vital', marriage: 'Vital', death: 'Vital', burial: 'Church' } },
});
