/**
 * How a child is linked to each partner of a family (#982, ADR 0027). Each child
 * link stores one value per partner, `FamilyPerson."Partner1Relationship"` and
 * `"Partner2Relationship"`, because one value per link can't describe a blended
 * family: the usual case is a birth child of one partner and a stepchild of the
 * other. The set matches Family Tree Maker's `_FREL` / `_MREL` and Gramps's
 * per-parent child reference, less FTM's Related, Sealed and Private, which have
 * no meaning here and ride the link's passthrough instead (ADR 0023).
 *
 * The columns are unchecked TEXT, so {@link isChildRelationshipType} is what
 * stands between untrusted input and a value the app doesn't model.
 */
export type ChildRelationshipType = 'Birth' | 'Adoption' | 'Foster' | 'Step' | 'Guardian' | 'Unknown';

export const CHILD_RELATIONSHIP_TYPE_VALUES: readonly ChildRelationshipType[] = [
    'Birth', 'Adoption', 'Foster', 'Step', 'Guardian', 'Unknown',
];

const CHILD_RELATIONSHIP_TYPE_SET: ReadonlySet<string> = new Set(CHILD_RELATIONSHIP_TYPE_VALUES);

/** Validate untrusted input (an API body, an imported GEDCOM value) against the set. */
export function isChildRelationshipType(value: unknown): value is ChildRelationshipType {
    return typeof value === 'string' && CHILD_RELATIONSHIP_TYPE_SET.has(value);
}

/** A child's link to each partner slot of one family. */
export interface ChildRelationships {
    partner1: ChildRelationshipType;
    partner2: ChildRelationshipType;
}

/** One type for both partners, or one per partner. */
export type ChildRelationshipInput = ChildRelationshipType | ChildRelationships;

export function childRelationshipsOf(input: ChildRelationshipInput = 'Birth'): ChildRelationships {
    return typeof input === 'string' ? { partner1: input, partner2: input } : input;
}

/** Untrusted input as a pair, or null when either value is outside the set. */
export function parseChildRelationships(value: unknown): ChildRelationships | null {
    if (isChildRelationshipType(value)) return childRelationshipsOf(value);
    if (typeof value !== 'object' || value === null) return null;
    const { partner1, partner2 } = value as Record<string, unknown>;
    return isChildRelationshipType(partner1) && isChildRelationshipType(partner2) ? { partner1, partner2 } : null;
}

/**
 * The one value the present partners share, or null when they differ. A slot
 * with no partner doesn't count, so a one-parent family always has one value.
 * With no partner at all, both slots count.
 */
export function sharedChildRelationship(
    partner1: string | null | undefined,
    partner2: string | null | undefined,
    present: { partner1: boolean; partner2: boolean },
): string | null {
    const a = partner1 ?? 'Birth';
    const b = partner2 ?? 'Birth';
    if (present.partner1 && !present.partner2) return a;
    if (present.partner2 && !present.partner1) return b;
    return a === b ? a : null;
}

/**
 * Family Tree Maker's `2 _FREL` / `2 _MREL` value (under `1 CHIL`) → the type,
 * keyed lowercase. FTM also writes Related, Sealed and Private, which have no type
 * and stay in the link's passthrough. `birth` is not FTM's word but other apps write it.
 */
export const FTM_VALUE_TO_CHILD_RELATIONSHIP: Readonly<Record<string, ChildRelationshipType>> = {
    natural: 'Birth',
    birth: 'Birth',
    adopted: 'Adoption',
    foster: 'Foster',
    step: 'Step',
    guardian: 'Guardian',
    unknown: 'Unknown',
};

/** The type → the value FTM writes for it. */
export const CHILD_RELATIONSHIP_TO_FTM_VALUE: Readonly<Record<ChildRelationshipType, string>> = {
    Birth: 'Natural',
    Adoption: 'Adopted',
    Foster: 'Foster',
    Step: 'Step',
    Guardian: 'Guardian',
    Unknown: 'Unknown',
};
