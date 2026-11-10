// Ancestor suppression for the dashboard "Places hot list".
//
// Rolling a place's gazetteer descendants into its count is what makes the hot-list
// row agree with the page it links to — but it also ranks countries above towns, so
// a top-five becomes "England, United States, Kent, …" and says nothing. A place is
// therefore dropped when one of its own descendants is already kept: the descendant
// is the more specific answer to the same question.
//
// Pure and separately tested — the SQL returns the ranked rows with their descendant
// sets, and the rule is far clearer as a loop than as another CTE.

export interface RankedPlace {
  place_name: string;
  /** Rolled total: own records + every gazetteer descendant's. pg bigint → string. */
  person_count: string;
  /** Records naming this exact place string. pg bigint → string. */
  own_count: string;
  /** Every gazetteer place strictly below this one, by name. */
  descendants: string[];
}

/**
 * Walk the ranked rows (highest count first), dropping a place when any of its own
 * gazetteer descendants holds records of its own — that descendant is the more
 * specific answer to the same question. Returns at most `limit` rows.
 *
 * Note this drops the ancestor outright rather than demoting it, so a surviving
 * row's rolled total always equals its own count. That is what keeps countries out
 * of a top five, and it is why the dashboard's "incl. sub-places" hint never fires
 * today (decision 2026-07-27, recorded in the release-readiness tracker §13.4).
 */
export function suppressCoveredAncestors<T extends RankedPlace>(ranked: T[], limit: number): T[] {
  // Precomputed once: a nested scan of `ranked` per candidate was O(n²) over a set
  // sized by the gazetteer, and in the static build it runs on the browser's main
  // thread on every dashboard load.
  const ownsRecords = new Set(
    ranked.filter((r) => Number(r.own_count) > 0).map((r) => r.place_name),
  );
  const descendantsOf = new Map(ranked.map((r) => [r.place_name, new Set(r.descendants)]));
  /** True when each place is below the other — i.e. a `ParentId` cycle, where
   *  neither is "the more specific answer" and letting them suppress each other
   *  would delete BOTH from the hot list even though both hold records. */
  const mutuallyBelow = (a: string, b: string) => descendantsOf.get(b)?.has(a) ?? false;
  const kept: T[] = [];
  for (const candidate of ranked) {
    // A cycle also puts a node in its OWN descendant set, so exclude self first.
    const coveredByDescendant = candidate.descendants.some(
      (name) => name !== candidate.place_name
        && ownsRecords.has(name)
        && !mutuallyBelow(candidate.place_name, name),
    );
    if (coveredByDescendant) continue;
    kept.push(candidate);
    if (kept.length === limit) break;
  }
  return kept;
}
