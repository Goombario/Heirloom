/**
 * A stored place → the parts a record search sends (#1025).
 *
 * The last comma part is the country and decides the regional sites, through
 * the alias table in `regions.ts`. A place with no country part ("Maidstone,
 * Kent") takes its country from the gazetteer instead, when the place is filed
 * under one there (#1030); otherwise it gets only the worldwide sites.
 *
 * Pure: no DB, no DOM.
 */

import { COUNTRIES, type CountryRegion } from '@/lib/research/regions';

export interface ResearchPlace {
    /** The place as sent: its parts joined by ", ", without a leading cemetery or church. */
    text: string;
    /** The first part: the town, parish or township. */
    locality: string;
    county: string;
    /** The state or province, for a country that has them. */
    state: string;
    /** The last part as written, or the gazetteer's country when the place names
     *  none; '' when the place has only a locality. */
    country: string;
    /** The region codes the place matches; empty when its country isn't known. */
    regions: string[];
}

/** A burial ground or church named before the town: the sites expect a town or county. */
const BURIAL_OR_CHURCH = /\b(?:cemetery|cemetary|churchyard|church|chapel|kirk|kirkyard|graveyard|burial ground|burying ground|memorial park|memorial gardens|mausoleum|crematorium)$|^(?:cimeti[eè]re|cemetery of)\b/i;

/** Case, accents, dots and spacing removed, so `U.S.A.` and `usa` match. */
function normalize(name: string): string {
    return name.normalize('NFD').replace(/\p{M}/gu, '').replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function matchCountry(part: string): CountryRegion | undefined {
    const key = normalize(part);
    return COUNTRIES.find(c => c.names.some(n => normalize(n) === key));
}

function matchSubdivision(country: CountryRegion, part: string): string | undefined {
    const key = normalize(part);
    return Object.entries(country.subdivisions ?? {}).find(([, names]) => names.some(n => normalize(n) === key))?.[0];
}

const lastPart = (name: string) => name.split(',').map(p => p.trim()).filter(Boolean).pop() ?? '';

/**
 * The country a place is filed under in the gazetteer, and the province on the
 * way when the country has them: the nearest jurisdiction whose last comma part
 * is a country, so "England" wins over the "United Kingdom" above it.
 * `ancestry` is the place's gazetteer chain, root first, the place included.
 */
function gazetteerParts(ancestry: readonly string[]): string[] {
    const upward = [...ancestry].reverse().map(lastPart);
    const at = upward.findIndex(part => matchCountry(part));
    if (at < 0) return [];
    const country = matchCountry(upward[at])!;
    const subdivision = upward.slice(0, at).find(part => matchSubdivision(country, part));
    return subdivision ? [subdivision, upward[at]] : [upward[at]];
}

/**
 * `ancestry`, when given, is the place's gazetteer chain (root first, the place
 * included). It is read only when the place's own last part is not a country: the
 * country it finds is treated as the missing last part, so "Maidstone, Kent" under
 * England parses as "Maidstone, Kent, England" while `text` stays as written.
 */
export function parsePlace(raw: string | null | undefined, ancestry: readonly string[] = []): ResearchPlace | null {
    let parts = (raw ?? '').split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length > 1 && BURIAL_OR_CHURCH.test(parts[0])) parts = parts.slice(1);
    if (parts.length === 0) return null;
    const text = parts.join(', ');

    if (!matchCountry(parts[parts.length - 1])) {
        const filed = gazetteerParts(ancestry);
        // The province may already be the place's own last part ("Halifax, Nova Scotia").
        if (filed.length === 2 && filed[0] === parts[parts.length - 1]) filed.shift();
        parts = [...parts, ...filed];
    }
    const country = matchCountry(parts[parts.length - 1]);
    if (parts.length === 1 && !country) {
        return { text, locality: parts[0], county: '', state: '', country: '', regions: [] };
    }

    const rest = parts.slice(0, -1);
    const last = rest.length - 1;
    const subdivision = country && rest.length > 0 ? matchSubdivision(country, rest[last]) : undefined;
    let locality = rest[0] ?? '';
    let county = '';
    let state = '';
    if (country?.states) {
        if (rest.length >= 2 || subdivision) state = rest[last] ?? '';
        if (rest.length >= 3) county = rest[last - 1];
        // "Ontario, Canada": the one part is the province, not a town.
        if (rest.length === 1 && subdivision) locality = '';
    } else if (rest.length >= 2) {
        county = rest[last];
    }
    return {
        text,
        locality,
        county,
        state,
        country: parts[parts.length - 1],
        regions: country ? [...country.regions, ...(subdivision ? [subdivision] : [])] : [],
    };
}
