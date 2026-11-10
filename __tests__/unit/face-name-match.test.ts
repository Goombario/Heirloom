import { describe, it, expect } from 'vitest';
import {
  createNameMatcher, matchNameInSnapshot, normalizeName,
  type PeopleNameSnapshot,
} from '@/lib/db/queries/media-faces';

/**
 * The feature's judgement centre: which name in a photo becomes which person.
 * A wrong verdict here writes bad data into a genealogy database, so every
 * precedence tier is pinned individually (#487).
 */
function snapshot(
  people: [number, string | null, string | null][],
  variants: [number, string | null][] = [],
): PeopleNameSnapshot {
  return {
    people: people.map(([Id, FirstName, LastName]) => ({ Id, FirstName, LastName })),
    variants: variants.map(([Id, Name]) => ({ Id, Name })),
  };
}

describe('normalizeName', () => {
  it('folds accents, case, and repeated whitespace', () => {
    expect(normalizeName('José  Álvarez')).toBe('jose alvarez');
    expect(normalizeName('  ADA   whitcombe ')).toBe('ada whitcombe');
  });
});

describe('face name matching', () => {
  it('tier 1: exactly one full-name match is exact', () => {
    const result = matchNameInSnapshot('Ada Whitcombe', snapshot([[7, 'Ada', 'Whitcombe'], [8, 'Rex', 'Pike']]));
    expect(result).toEqual({ personId: 7, kind: 'exact', candidateCount: 1, candidateIds: [7] });
  });

  it('tier 1 matches through accent and case folding', () => {
    const result = matchNameInSnapshot('jose  ALVAREZ', snapshot([[3, 'José', 'Álvarez']]));
    expect(result.kind).toBe('exact');
    expect(result.personId).toBe(3);
  });

  it('tier 1: two people with the same full name are ambiguous, with no suggestion', () => {
    const result = matchNameInSnapshot(
      'Ada Whitcombe',
      snapshot([[7, 'Ada', 'Whitcombe'], [9, 'Ada', 'Whitcombe'], [8, 'Rex', 'Pike']]),
    );
    expect(result).toEqual({ personId: null, kind: 'ambiguous', candidateCount: 2, candidateIds: [7, 9] });
  });

  it('tier 2: a NameVariant match is a variant, and only runs when no exact match exists', () => {
    const snap = snapshot([[7, 'Adelaide', 'Whitcombe']], [[7, 'Ada Whitcombe']]);
    expect(matchNameInSnapshot('Ada Whitcombe', snap)).toEqual({ personId: 7, kind: 'variant', candidateCount: 1, candidateIds: [7] });
    // An exact full-name match on someone else outranks the variant entirely.
    const withExact = snapshot([[7, 'Adelaide', 'Whitcombe'], [11, 'Ada', 'Whitcombe']], [[7, 'Ada Whitcombe']]);
    expect(matchNameInSnapshot('Ada Whitcombe', withExact)).toEqual({ personId: 11, kind: 'exact', candidateCount: 1, candidateIds: [11] });
  });

  it('tier 2: two people sharing a variant are ambiguous', () => {
    const snap = snapshot([[7, 'Adelaide', 'Whitcombe'], [9, 'Ada', 'Pike']], [[7, 'Ada W'], [9, 'Ada W']]);
    expect(matchNameInSnapshot('Ada W', snap)).toEqual({ personId: null, kind: 'ambiguous', candidateCount: 2, candidateIds: [7, 9] });
  });

  it('tier 2: several variants of the SAME person still count as one', () => {
    const snap = snapshot([[7, 'Adelaide', 'Whitcombe']], [[7, 'Ada Whitcombe'], [7, 'ada  whitcombe']]);
    expect(matchNameInSnapshot('Ada Whitcombe', snap)).toEqual({ personId: 7, kind: 'variant', candidateCount: 1, candidateIds: [7] });
  });

  it('tier 3: first + last ignoring middle names is a variant', () => {
    const snap = snapshot([[7, 'Ada', 'Whitcombe']]);
    expect(matchNameInSnapshot('Ada Mary Whitcombe', snap)).toEqual({ personId: 7, kind: 'variant', candidateCount: 1, candidateIds: [7] });
  });

  it('tier 3: two people matching the shortened name are ambiguous', () => {
    const snap = snapshot([[7, 'Ada', 'Whitcombe'], [9, 'Ada', 'Whitcombe']]);
    expect(matchNameInSnapshot('Ada Mary Whitcombe', snap)).toEqual({ personId: null, kind: 'ambiguous', candidateCount: 2, candidateIds: [7, 9] });
  });

  it('tier 3 never fires for a two-word name — a partial name is not a match', () => {
    // "Ada" alone must not resolve to Ada Whitcombe: a suggestion has to be
    // right, not merely plausible.
    expect(matchNameInSnapshot('Ada', snapshot([[7, 'Ada', 'Whitcombe']])).kind).toBe('none');
  });

  it('nobody matching is none, with no suggestion', () => {
    expect(matchNameInSnapshot('Unknown Person', snapshot([[7, 'Ada', 'Whitcombe']])))
      .toEqual({ personId: null, kind: 'none', candidateCount: 0, candidateIds: [] });
  });

  it('an empty or whitespace-only name is none', () => {
    expect(matchNameInSnapshot('   ', snapshot([[7, 'Ada', 'Whitcombe']])).kind).toBe('none');
  });

  it('a person with no name at all is never matched', () => {
    expect(matchNameInSnapshot('Ada Whitcombe', snapshot([[7, null, null]])).kind).toBe('none');
  });

  it('memoises repeated names — the whole premise of grouping by name', () => {
    const matcher = createNameMatcher(snapshot([[7, 'Ada', 'Whitcombe']]));
    const first = matcher.match('Ada Whitcombe');
    // Same object identity: the second lookup did no work at all.
    expect(matcher.match('ada  WHITCOMBE')).toBe(first);
  });

  it('exposes display names for the queue labels', () => {
    const matcher = createNameMatcher(snapshot([[7, 'Ada', 'Whitcombe'], [8, 'Rex', null]]));
    expect(matcher.displayName(7)).toBe('Ada Whitcombe');
    expect(matcher.displayName(8)).toBe('Rex');
    expect(matcher.displayName(999)).toBeNull();
  });
});

/**
 * The queue needs more than "which person" — it needs enough about that person
 * to tell two same-named candidates apart on a chip. Years come from the SAME
 * snapshot the matcher already reads, so this costs no extra query.
 */
describe('name matcher person references', () => {
  const dated = (): PeopleNameSnapshot => ({
    people: [
      { Id: 7, FirstName: 'Ada', LastName: 'Whitcombe', BirthDate: '1902-04-11', DeathDate: '1988-01-02' },
      { Id: 9, FirstName: 'Ada', LastName: 'Whitcombe', BirthDate: '1918', DeathDate: null },
      { Id: 11, FirstName: 'Rex', LastName: null, BirthDate: null, DeathDate: null },
    ],
    variants: [],
  });

  it('returns id, display name, and birth/death years for a person', () => {
    const matcher = createNameMatcher(dated());
    expect(matcher.person(7)).toEqual({
      id: 7, name: 'Ada Whitcombe', birthYear: '1902', deathYear: '1988',
      // No photo on this snapshot — the chip falls back to an initials disc.
      sex: null, mediaId: null, focalX: null, focalY: null, focalRadius: null,
    });
  });

  it('leaves missing years null rather than inventing them', () => {
    const matcher = createNameMatcher(dated());
    expect(matcher.person(9)).toEqual({
      id: 9, name: 'Ada Whitcombe', birthYear: '1918', deathYear: null,
      sex: null, mediaId: null, focalX: null, focalY: null, focalRadius: null,
    });
    expect(matcher.person(11)).toEqual({
      id: 11, name: 'Rex', birthYear: null, deathYear: null,
      sex: null, mediaId: null, focalX: null, focalY: null, focalRadius: null,
    });
  });

  it('returns null for an unknown id', () => {
    expect(createNameMatcher(dated()).person(999)).toBeNull();
  });

  it('resolves every ambiguous candidate id to a person reference', () => {
    const matcher = createNameMatcher(dated());
    const match = matcher.match('Ada Whitcombe');

    expect(match.kind).toBe('ambiguous');
    expect(match.candidateIds).toEqual([7, 9]);
    // The whole point: an ambiguous group can render one chip per candidate.
    expect(match.candidateIds.map(id => matcher.person(id))).toEqual([
      {
        id: 7, name: 'Ada Whitcombe', birthYear: '1902', deathYear: '1988',
        sex: null, mediaId: null, focalX: null, focalY: null, focalRadius: null,
      },
      {
        id: 9, name: 'Ada Whitcombe', birthYear: '1918', deathYear: null,
        sex: null, mediaId: null, focalX: null, focalY: null, focalRadius: null,
      },
    ]);
  });

  it('keeps candidateIds and candidateCount in agreement at every tier', () => {
    const matcher = createNameMatcher(dated());
    for (const name of ['Ada Whitcombe', 'Rex', 'Nobody At All', '   ']) {
      const match = matcher.match(name);
      expect(match.candidateIds).toHaveLength(match.candidateCount);
    }
  });
});
