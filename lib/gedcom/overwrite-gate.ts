import type { TreeCounts } from '@/lib/data/types';

/**
 * Gate for the destructive `overwrite` GEDCOM import.
 *
 * Overwrite deletes the tree that is **in the database** before inserting the
 * file's records. The confirmation step must therefore describe the *current
 * tree*, never the selected file — and it has nothing to warn about when the
 * current tree is empty.
 */

/** The two counts the warning copy names, when there are any worth naming. */
export interface NamedCounts {
    people: number;
    families: number;
}

export type OverwriteGate =
    /** Nothing to destroy — run the import without a confirmation step. */
    | { action: 'proceed' }
    /**
     * Confirm first. `counts` is null when there is nothing worth naming — either
     * the live counts could not be read, or the tree holds only media/cases/etc.
     * and reading "all 0 people, 0 families" would be absurd.
     */
    | { action: 'confirm'; counts: NamedCounts | null };

/**
 * Decides whether an overwrite import needs confirming, given the live counts of
 * the tree it would replace (`getTreeCountsService` — its fields mirror the
 * overwrite DELETE block one-for-one).
 *
 * Fails safe in both directions:
 *  - `null` counts (unreadable tree) always confirm; assuming an empty tree would
 *    skip the last guard in front of an irreversible delete.
 *  - `proceed` requires *every* count to be exactly 0. Any other value — a
 *    negative, a NaN, a field this code has never heard of — confirms. Iterating
 *    `Object.values` rather than a fixed list is deliberate: a table added to
 *    `TreeCounts` later then participates in the emptiness test automatically,
 *    instead of silently defaulting to "nothing to lose".
 */
export function gateOverwriteImport(counts: TreeCounts | null): OverwriteGate {
    if (counts === null) return { action: 'confirm', counts: null };

    const isEmpty = Object.values(counts).every((n) => n === 0);
    if (isEmpty) return { action: 'proceed' };

    // Something is there. Name it only if people/families can describe it.
    const { people, families } = counts;
    if (people <= 0 && families <= 0) return { action: 'confirm', counts: null };
    return { action: 'confirm', counts: { people, families } };
}
