import { describe, it, expect } from 'vitest';
import { suppressCoveredAncestors } from '@/lib/db/queries/place-rollup';

const row = (place_name: string, person_count: number, descendants: string[] = [], own_count = person_count) =>
  ({ place_name, person_count: String(person_count), own_count: String(own_count), descendants });

describe('suppressCoveredAncestors', () => {
  it('drops an ancestor when one of its descendants ranks above it', () => {
    const kept = suppressCoveredAncestors([
      row('England', 142, ['Kent', 'Dover', 'Faversham']),
      row('Kent', 63, ['Dover', 'Faversham']),
      row('Dover', 18),
      row('Brooklyn, NY', 14),
    ], 5);

    expect(kept.map((r) => r.place_name)).toEqual(['Dover', 'Brooklyn, NY']);
  });

  it('keeps a parent whose descendants contribute nothing of their own', () => {
    const kept = suppressCoveredAncestors([
      row('Kent', 20, ['Dover']),
      row('Brooklyn, NY', 14),
    ], 5);

    expect(kept.map((r) => r.place_name)).toEqual(['Kent', 'Brooklyn, NY']);
  });

  it('honours the limit after suppression, not before', () => {
    const kept = suppressCoveredAncestors([
      row('England', 142, ['Kent', 'Dover']),
      row('Kent', 63, ['Dover']),
      row('Dover', 18),
      row('Brooklyn, NY', 14),
      row('Cannington', 11),
    ], 2);

    expect(kept.map((r) => r.place_name)).toEqual(['Dover', 'Brooklyn, NY']);
  });

  it('leaves a flat list untouched', () => {
    const kept = suppressCoveredAncestors([row('A', 3), row('B', 2)], 5);
    expect(kept.map((r) => r.place_name)).toEqual(['A', 'B']);
  });

  it('returns an empty list unchanged', () => {
    expect(suppressCoveredAncestors([], 5)).toEqual([]);
  });

  it('drops a rolled-up ancestor whose own count is lower than its total', () => {
    // The shape the SQL actually produces for a parent: rolled 63, own 40, with a
    // record-owning child. Every other fixture here has own === rolled, which never
    // happens for an ancestor.
    const kept = suppressCoveredAncestors([
      row('Kent', 63, ['Dover'], 40),
      row('Dover', 23),
    ], 5);

    expect(kept.map((r) => r.place_name)).toEqual(['Dover']);
  });

  it('keeps both places of a ParentId cycle when both hold records', () => {
    // A cycle puts each node in the other's descendant set (and in its own). Left
    // unguarded they suppress each other and BOTH vanish from the hot list, even
    // though each holds records.
    const kept = suppressCoveredAncestors([
      row('A', 4, ['B', 'A']),
      row('B', 3, ['A', 'B']),
    ], 5);

    expect(kept.map((r) => r.place_name)).toEqual(['A', 'B']);
  });
});
