import type { CaseClaim, CaseFinding } from '@/lib/db/schema';

/** The fact keys a claim can name, each with a `caseResearch.what_*` label (#58). Anything else is the researcher's own words. */
export const CLAIM_KEYS = ['BIRT', 'BAPM', 'DEAT', 'BURI', 'MARR', 'RESI', 'OCCU', 'CENS', 'EMIG', 'IMMI', 'NATU', 'PARENTS'] as const;
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

export interface ClaimSide { claim: CaseClaim; finding: CaseFinding }
export interface ClaimConflict { key: string; a: ClaimSide; b: ClaimSide }

/**
 * Pairs of claims from different findings about the same thing and the same
 * person that say different things (#58, "Two findings disagree"), oldest
 * finding first. Two claims both rejected no longer disagree about anything.
 */
export function claimConflicts(findings: readonly CaseFinding[]): ClaimConflict[] {
    const sides = findings.flatMap((finding) => finding.claims.map((claim) => ({ claim, finding })));
    const out: ClaimConflict[] = [];
    for (let i = 0; i < sides.length; i++) {
        for (let j = i + 1; j < sides.length; j++) {
            const a = sides[i];
            const b = sides[j];
            if (a.finding.Id === b.finding.Id || a.claim.What !== b.claim.What || subject(a.claim) !== subject(b.claim)) continue;
            if (says(a.claim) === says(b.claim)) continue;
            if (a.claim.Decision === 'rejected' && b.claim.Decision === 'rejected') continue;
            out.push({ key: `${a.claim.Id}-${b.claim.Id}`, a, b });
        }
    }
    return out;
}

/** Which holds, read back from the two decisions. */
export type Holds = 'a' | 'b' | 'both' | 'undecided';
export function whichHolds(c: ClaimConflict): Holds {
    const [x, y] = [c.a.claim.Decision, c.b.claim.Decision];
    if (x === 'accepted' && y === 'accepted') return 'both';
    if (x === 'accepted' && y === 'rejected') return 'a';
    if (x === 'rejected' && y === 'accepted') return 'b';
    return 'undecided';
}

/** The two decisions that say which holds. */
export function holdsDecisions(holds: Holds): [CaseClaim['Decision'], CaseClaim['Decision']] {
    if (holds === 'a') return ['accepted', 'rejected'];
    if (holds === 'b') return ['rejected', 'accepted'];
    if (holds === 'both') return ['accepted', 'accepted'];
    return ['undecided', 'undecided'];
}
