import { describe, it, expect } from 'vitest';
import { filterTreePeople, bestModeFor } from '@/app/tree/tree-page-helpers';

// Characterization tests — lock the tree search + best-mode logic before extracting it.

const people = [
  { id: 1, name: 'Ada Lovelace', allNames: 'Augusta Byron' },
  { id: 2, name: 'Charles Babbage', allNames: null },
  { id: 3, name: 'Grace Hopper' },
];

describe('filterTreePeople', () => {
  it('returns everyone for an empty/whitespace query', () => {
    expect(filterTreePeople(people, '').length).toBe(3);
    expect(filterTreePeople(people, '   ').length).toBe(3);
  });
  it('matches all tokens (AND) across name + allNames, case-insensitively', () => {
    expect(filterTreePeople(people, 'ada').map(p => p.id)).toEqual([1]);
    expect(filterTreePeople(people, 'augusta byron').map(p => p.id)).toEqual([1]);
    expect(filterTreePeople(people, 'grace HOPPER').map(p => p.id)).toEqual([3]);
  });
  it('returns nothing when a token is absent', () => {
    expect(filterTreePeople(people, 'ada zzz')).toEqual([]);
  });
});

describe('bestModeFor', () => {
  it('chooses focus when both directions exist', () => {
    expect(bestModeFor({ hasAncestors: true, hasDescendants: true })).toBe('focus');
  });
  it('chooses focus for a leaf — ancestors but no descendants', () => {
    expect(bestModeFor({ hasAncestors: true, hasDescendants: false })).toBe('focus');
  });
  it('chooses descendants when there are no ancestors to focus around', () => {
    expect(bestModeFor({ hasAncestors: false, hasDescendants: true })).toBe('descendants');
  });
  it('defaults to descendants when neither exists or info is missing', () => {
    expect(bestModeFor({ hasAncestors: false, hasDescendants: false })).toBe('descendants');
    expect(bestModeFor(undefined)).toBe('descendants');
  });
});
