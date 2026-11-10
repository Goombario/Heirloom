/**
 * Countries and provinces a record site can be limited to (#1017, "Places").
 *
 * Data only, so adding a country is an edit here: its region codes, the names
 * and abbreviations a place may end with, and, for a country whose next part
 * is a state or province, the subdivisions that pick provincial sites.
 *
 * Region codes are ISO 3166: `US`, `CA`, the UK nations as 3166-2 (`GB-ENG`),
 * and a province as 3166-2 (`CA-NS`). A site lists the codes it covers.
 */

export interface CountryRegion {
    /** The region codes a place in this country matches. */
    regions: string[];
    /** Names and abbreviations, matched ignoring case, accents and dots. */
    names: string[];
    /** True when the part before the country is a state or province, not a county. */
    states?: boolean;
    /** A subdivision's region code → its names, matched on the part before the country. */
    subdivisions?: Record<string, string[]>;
}

export const COUNTRIES: CountryRegion[] = [
    { regions: ['US'], names: ['United States', 'United States of America', 'USA', 'US'], states: true },
    // "UK" can't say which nation, so it gets the England and Wales sites and the Scottish ones.
    { regions: ['GB-ENG', 'GB-WLS', 'GB-SCT'], names: ['United Kingdom', 'UK', 'Great Britain', 'GB', 'Britain'] },
    { regions: ['GB-ENG'], names: ['England'] },
    { regions: ['GB-WLS'], names: ['Wales', 'Cymru'] },
    { regions: ['GB-SCT'], names: ['Scotland'] },
    // Before 1922 "Ireland" was the whole island, and the Irish sites cover both, so a
    // Northern Ireland place gets them too; "UK" still doesn't.
    { regions: ['GB-NIR'], names: ['Northern Ireland'] },
    { regions: ['IE'], names: ['Ireland', 'Republic of Ireland', 'Éire', 'Eire', 'Irish Free State'] },
    { regions: ['AU'], names: ['Australia'], states: true },
    { regions: ['NZ'], names: ['New Zealand', 'NZ', 'Aotearoa'] },
    { regions: ['NL'], names: ['Netherlands', 'The Netherlands', 'Nederland', 'Holland'] },
    { regions: ['BE'], names: ['Belgium', 'België', 'Belgique', 'Belgien'] },
    {
        regions: ['CA'],
        names: ['Canada'],
        states: true,
        subdivisions: {
            'CA-AB': ['Alberta', 'AB', 'Alta'],
            'CA-BC': ['British Columbia', 'BC'],
            'CA-MB': ['Manitoba', 'MB', 'Man'],
            'CA-NB': ['New Brunswick', 'NB'],
            'CA-NL': ['Newfoundland and Labrador', 'Newfoundland', 'Labrador', 'NL', 'Nfld'],
            'CA-NS': ['Nova Scotia', 'NS'],
            'CA-NT': ['Northwest Territories', 'NT', 'NWT'],
            'CA-NU': ['Nunavut', 'NU'],
            'CA-ON': ['Ontario', 'ON', 'Ont', 'Upper Canada', 'Canada West'],
            'CA-PE': ['Prince Edward Island', 'PE', 'PEI'],
            'CA-QC': ['Quebec', 'QC', 'Que', 'PQ', 'Lower Canada', 'Canada East'],
            'CA-SK': ['Saskatchewan', 'SK', 'Sask'],
            'CA-YT': ['Yukon', 'YT', 'Yukon Territory'],
        },
    },
];
