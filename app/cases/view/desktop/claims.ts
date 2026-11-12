import type { CaseClaim, CaseFinding } from '@/lib/db/schema';

/** The fact keys a claim can name, each with a `caseResearch.what_*` label (#58). Anything else is the researcher's own words. */
const CLAIM_KEYS = ['BIRT', 'BAPM', 'DEAT', 'BURI', 'MARR', 'RESI', 'OCCU', 'CENS', 'EMIG', 'IMMI', 'NATU', 'PARENTS'] as const;
const KEYS: ReadonlySet<string> = new Set(CLAIM_KEYS);

/** A claim's "what", translated when it is a known key. */
export function claimWhat(what: string, t: (key: string) => string): string {
    return KEYS.has(what) ? t(`what_${what}`) : what;
}

/** Who a claim is about, as the matching key: the tree person, or the record's name. */
const subject = (c: CaseClaim) => (c.PersonId != null ? `p${c.PersonId}` : `n${(c.PersonName ?? '').trim().toLowerCase()}`);
const norm = (v: string | null) => (v ?? '').trim().toLowerCase();
const says = (c: CaseClaim) => [norm(c.Says), norm(c.Date), norm(c.Place)].join('|');

export interface ClaimRelation {
    /** Other findings whose claim about the same thing says the same. */
    agrees: number;
    /** The source titles of findings whose claim about the same thing says otherwise. */
    conflicts: string[];
}

/**
 * How each claim stands against the other findings on screen (#58): the same
 * thing about the same person, saying the same or something else. Only these
 * useful subtitles show; a claim with no match shows none.
 */
export function claimRelations(findings: readonly CaseFinding[]): Map<number, ClaimRelation> {
    const out = new Map<number, ClaimRelation>();
    for (const f of findings) {
        for (const c of f.claims) {
            const rel: ClaimRelation = { agrees: 0, conflicts: [] };
            for (const g of findings) {
                if (g.Id === f.Id) continue;
                const match = g.claims.find((o) => o.What === c.What && subject(o) === subject(c));
                if (!match) continue;
                if (says(match) === says(c)) rel.agrees++;
                else rel.conflicts.push(g.citation?.sourceTitle ?? '');
            }
            out.set(c.Id, rel);
        }
    }
    return out;
}
