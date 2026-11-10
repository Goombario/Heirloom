import type { PersonResult } from '@/lib/db/schema';

/** A relationship that tells same-named people apart: their parents, else a partner. */
export type PersonKin = { kind: 'child' | 'partner'; names: string };

/**
 * The parents a person is a child of, else their first partner (#768, #793).
 * Reads the `ParentName1`/`ParentName2`/`PartnerName` columns people search returns.
 */
export function personKin(p: PersonResult): PersonKin | undefined {
    const parents = [p.ParentName1, p.ParentName2].filter(Boolean).join(' & ');
    if (parents) return { kind: 'child', names: parents };
    return p.PartnerName ? { kind: 'partner', names: p.PartnerName } : undefined;
}
