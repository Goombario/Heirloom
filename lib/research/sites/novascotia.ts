import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'novascotia',
    name: 'Nova Scotia Historical Vital Statistics',
    repository: { name: 'Nova Scotia Archives', website: 'https://archives.novascotia.ca' },
    // Births and deaths have a search form only, so just marriages are linked.
    factKinds: ['marriage'],
    regions: ['CA-NS'],
    status: 'observed',
    verified: '2026-10-04',
    docs: 'https://archives.novascotia.ca/vital-statistics/',
    // The person is the bride or the groom by sex.
    requires: ['surname', 'sex'],
    years: { min: 1763 },
    search: {
        url: 'https://archives.novascotia.ca/vital-statistics/marriage/results/',
        params: [
            { param: 'M', const: 'marriage' },
            { param: 'reset', const: 'yes' },
            { param: 'BFirst', value: 'givenFirst', when: { sex: 'F' } },
            { param: 'BLast', value: 'surname', when: { sex: 'F' } },
            { param: 'GFirst', value: 'spouse.givenFirst', when: { sex: 'F' } },
            { param: 'GLast', value: 'spouse.surname', when: { sex: 'F' } },
            { param: 'GFirst', value: 'givenFirst', when: { sex: 'M' } },
            { param: 'GLast', value: 'surname', when: { sex: 'M' } },
            { param: 'BFirst', value: 'spouse.givenFirst', when: { sex: 'M' } },
            { param: 'BLast', value: 'spouse.surname', when: { sex: 'M' } },
            { param: 'sYear', value: 'event.yearFrom' },
            { param: 'eYear', value: 'event.yearTo' },
        ],
    },
    prefill: { type: 'Vital' },
});
