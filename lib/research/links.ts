/**
 * A query → each offered site's search: a link to open, or a form-only site's
 * search page and the values to copy in (#1017 section 3; #1026).
 *
 * Heirloom never fetches a results page: every search is a link the person
 * opens. Pure: no DB, no DOM.
 */

import type { FactKind, ResearchQuery } from '@/lib/research/fact-query';
import { queryValue } from '@/lib/research/query';
import type { Condition, FormFieldLabel, Requirement, SiteDefinition, SiteParam } from '@/lib/research/site';
import { SITES } from '@/lib/research/sites';
import type { SourceType } from '@/lib/db/queries/sources';
import { applyTransforms } from '@/lib/research/transforms';

/** Why a site can't run, as a message key under `research.reasons` and its values. */
type BlockedReason =
    | { key: 'needs_surname' | 'needs_name' | 'needs_full_name' | 'needs_sex' }
    | { key: 'starts_in' | 'ends_in'; year: number };

export interface SiteSearch {
    site: SiteDefinition;
    /** Set when the search can't run; Open is then disabled. */
    blocked: BlockedReason | null;
    /** The search link, or a form-only site's search page. */
    url: string;
    /** A form-only site's values, to copy in. Empty for a link. */
    fields: { label: FormFieldLabel; value: string }[];
    /** Second searches, such as "Mrs. Walter Ashby". */
    alternates: { label: string; url: string }[];
}

const REQUIREMENT_REASONS: Record<Requirement, BlockedReason> = {
    surname: { key: 'needs_surname' },
    name: { key: 'needs_name' },
    fullName: { key: 'needs_full_name' },
    sex: { key: 'needs_sex' },
};

function meets(q: ResearchQuery, requirement: Requirement): boolean {
    switch (requirement) {
        case 'surname': return queryValue(q, 'surname') !== '';
        case 'name': return queryValue(q, 'fullName') !== '';
        case 'fullName': return queryValue(q, 'fullNamePhrase') !== '';
        case 'sex': return q.sex !== null;
    }
}

function holds(q: ResearchQuery, when: Condition | undefined): boolean {
    if (!when) return true;
    if (when.sex && q.sex !== when.sex) return false;
    return (when.has ?? []).every(key => queryValue(q, key) !== '');
}

/** The value one parameter or field sends, or '' when it doesn't apply. */
function resolve(q: ResearchQuery, spec: Omit<SiteParam, 'param'>): string {
    if (spec.kinds && !spec.kinds.includes(q.kind)) return '';
    if (!holds(q, spec.when)) return '';
    if (spec.const !== undefined) return spec.const;
    const keys = Array.isArray(spec.value) ? spec.value : spec.value ? [spec.value] : [];
    const raw = keys.map(key => queryValue(q, key)).filter(Boolean).join(' ');
    return applyTransforms(spec.map?.[raw] ?? raw, spec.transform);
}

function link(url: string, q: ResearchQuery, params: SiteParam[]): string {
    const out = new URL(url);
    for (const p of params) {
        const value = resolve(q, p);
        if (value) out.searchParams.append(p.param, value);
    }
    return out.toString();
}

function blockedBy(site: SiteDefinition, q: ResearchQuery): BlockedReason | null {
    const unmet = (site.requires ?? []).find(r => !meets(q, r));
    if (unmet) return REQUIREMENT_REASONS[unmet];
    const { min, max } = site.years ?? {};
    if (q.years && min !== undefined && q.years.to < min) return { key: 'starts_in', year: min };
    if (q.years && max !== undefined && q.years.from > max) return { key: 'ends_in', year: max };
    return null;
}

/** The sites offered for a query: those covering its fact kind, and its place's region unless worldwide. */
export function sitesFor(q: ResearchQuery, sites: readonly SiteDefinition[] = SITES): SiteDefinition[] {
    return sites.filter(s => s.factKinds.includes(q.kind)
        && (!s.regions || s.regions.some(r => q.place?.regions.includes(r))));
}

export function siteSearch(site: SiteDefinition, q: ResearchQuery): SiteSearch {
    const blocked = blockedBy(site, q);
    const { search } = site;
    if (search.kind === 'form') {
        const fields = search.fields
            .map(f => ({ label: f.label, value: resolve(q, f) }))
            .filter(f => f.value);
        return { site, blocked, url: search.url, fields, alternates: [] };
    }
    const alternates = blocked ? [] : (site.alternates ?? [])
        .filter(alt => holds(q, alt.when))
        .map(alt => {
            const replaced = new Set(alt.params.map(p => p.param));
            return {
                label: resolve(q, alt.params[0]),
                url: link(search.url, q, [...search.params.filter(p => !replaced.has(p.param)), ...alt.params]),
            };
        })
        .filter(alt => alt.label);
    return { site, blocked, url: link(search.url, q, search.params), fields: [], alternates };
}

/** The source type a site settles for a fact kind, if any. */
export function prefillType(site: SiteDefinition, kind: FactKind): SourceType | undefined {
    const type = site.prefill?.type;
    return typeof type === 'string' ? type : type?.[kind];
}
