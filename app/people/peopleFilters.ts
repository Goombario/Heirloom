import type { PeopleFlag } from '@/lib/db/queries/data-quality';

/** Filter state for an invertible predicate: unset, matches, or explicitly does not match. */
export type TriState = 'off' | 'yes' | 'no';

/**
 * The home suggestion whose people come from a server query rather than a
 * list predicate (#794): likely duplicates. The missing-parents and no-events
 * suggestions were removed (#834): that research never finishes, so their
 * counts could never reach zero.
 */
export function flagFromUrlFilter(filter: string | null): PeopleFlag | null {
  return filter === 'duplicates' ? filter : null;
}

/** off → yes → no → off. One chip, one tap target, works on touch. */
export function cycleTri(state: TriState): TriState {
  return state === 'off' ? 'yes' : state === 'yes' ? 'no' : 'off';
}

/** Apply a tri-state filter to a boolean predicate result. */
export function matchesTri(state: TriState, value: boolean): boolean {
  return state === 'off' ? true : state === 'yes' ? value : !value;
}

/**
 * 'X' = a recorded value that is neither male nor female (the app writes 'X' for
 * nonbinary; a GEDCOM import can carry other codes through verbatim).
 * 'U' = no recorded value at all — a NULL/blank column, or GEDCOM 5.5.1's own
 * 'U' (undetermined), which says the same thing.
 *
 * The two used to share one bucket (#427), which asserted that "we know this
 * person is nonbinary" and "we have not recorded a sex for this person" are the
 * same fact. They are not, and the second is by far the larger group in an
 * imported tree — so the first could not be filtered for at all.
 */
export type SexBucket = 'M' | 'F' | 'X' | 'U';

/** Which bucket a stored `People."Sex"` value falls in. */
export function sexBucketOf(sex: string | null | undefined): SexBucket {
  const v = (sex ?? '').trim().toUpperCase();
  if (v === 'M') return 'M';
  if (v === 'F') return 'F';
  // Blank, or GEDCOM's explicit "undetermined" — both mean nothing was recorded.
  if (v === '' || v === 'U') return 'U';
  return 'X';
}

/** Whether a person belongs in the given bucket. */
export function matchesSexBucket(bucket: SexBucket, sex: string | null | undefined): boolean {
  return sexBucketOf(sex) === bucket;
}

/**
 * The sex buckets that actually match someone in the loaded set, in display
 * order. The cycle used to be hardcoded M → F → X, so a tree with no
 * unrecorded-sex people still offered a dead step that matched nobody.
 */
export function sexBucketsPresent(people: Array<{ Sex?: string | null }>): SexBucket[] {
  const present = new Set<SexBucket>();
  for (const p of people) present.add(sexBucketOf(p.Sex));
  return (['M', 'F', 'X', 'U'] as const).filter((b) => present.has(b));
}
