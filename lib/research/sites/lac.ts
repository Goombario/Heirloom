import { defineSite } from '@/lib/research/site';

export default defineSite({
    id: 'lac',
    name: 'Library and Archives Canada',
    repository: { name: 'Library and Archives Canada', website: 'https://www.canada.ca/en/library-archives.html' },
    factKinds: ['name', 'birth', 'census', 'residence', 'marriage', 'immigration', 'death', 'burial'],
    regions: ['CA'],
    // From the collection search's own result URL, filtered to Genealogy.
    status: 'observed',
    verified: '2026-10-13',
    docs: 'https://recherche-collection-search.bac-lac.gc.ca/eng/Home/Search',
    requires: ['surname'],
    search: {
        url: 'https://recherche-collection-search.bac-lac.gc.ca/eng/Home/Result',
        params: [
            { param: 'ST', const: 'STAD' },
            { param: 'DataSource', const: 'Genealogy' },
            { param: 'DataSourceSel', const: 'Genealogy' },
            { param: 'q_type_1', const: 'q' },
            // "All these words", so a middle name the record lacks would hide it.
            { param: 'q_1', value: ['givenFirst', 'surname'] },
            // `DateBucket` filters to one year, so it's sent only for a census, whose year is exact.
            { param: 'DateBucket', value: 'event.yearMid', kinds: ['census'] },
        ],
    },
});
