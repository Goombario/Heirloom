import { describe, it, expect } from 'vitest';
import {
  flattenWithAncestry,
  levelRows,
  matchesQuery,
  regionFromName,
} from '@/app/places/explore/drillRows';
import type { PlaceTreeNode } from '@/lib/places/hierarchy';

function node(name: string, over: Partial<PlaceTreeNode> = {}): PlaceTreeNode {
  return {
    id: null, name, parentId: null, ownCount: 1, rolledCount: 1, peopleCount: 1,
    faces: [], latitude: null, longitude: null, pinSuppressed: false,
    pinState: 'none', children: [], ...over,
  };
}

/**
 * Two places both recorded as a bare `Dover`, in different countries — the exact
 * case #417 was filed for. Only the gazetteer parent tells them apart.
 */
function twoDovers(): PlaceTreeNode[] {
  const ukDover = node('Dover', { id: 3, parentId: 1 });
  const uk = node('United Kingdom', { id: 1, children: [ukDover] });
  const usDover = node('Dover', { id: 4, parentId: 2 });
  const us = node('United States', { id: 2, children: [usDover] });
  return [uk, us];
}

const regionOf = (rows: ReturnType<typeof flattenWithAncestry>, name: string) =>
  rows.filter((r) => r.node.name === name).map((r) => r.region);

describe('flattenWithAncestry', () => {
  it('distinguishes two comma-less places by their gazetteer parent', () => {
    const rows = flattenWithAncestry(twoDovers());

    // Before #417 both rendered with an empty region and were indistinguishable.
    expect(regionOf(rows, 'Dover')).toEqual(['United Kingdom', 'United States']);
  });

  it('reads nearest parent first, the way a place string does', () => {
    const buckland = node('Buckland Cemetary', { id: 5 });
    const dover = node('Dover', { id: 3, children: [buckland] });
    const uk = node('United Kingdom', { id: 1, children: [dover] });

    const rows = flattenWithAncestry([uk]);

    expect(regionOf(rows, 'Buckland Cemetary')).toEqual(['Dover, United Kingdom']);
  });

  it('uses only the first segment of each ancestor, so the trail does not repeat itself', () => {
    const leaf = node('St Marys', { id: 9 });
    const dover = node('Dover, Kent, England', { id: 3, children: [leaf] });

    const rows = flattenWithAncestry([dover]);

    // Not "Dover, Kent, England" — the ancestor contributes its label, not its
    // whole jurisdiction string.
    expect(regionOf(rows, 'St Marys')).toEqual(['Dover']);
  });

  it('falls back to the name-derived region for a root with no parent', () => {
    const rows = flattenWithAncestry([node('Cannington, Somerset, England', { id: 7 })]);

    expect(rows[0].region).toBe('Somerset, England');
  });

  it('leaves an unparented comma-less place with no region — the #151 residue', () => {
    // Two bare roots stay identical: the ancestry does not exist to show. Stated
    // so the limitation is asserted rather than discovered later.
    const rows = flattenWithAncestry([node('Dover', { id: 3 }), node('Dover', { id: 4 })]);

    expect(rows.map((r) => r.region)).toEqual(['', '']);
  });

  it('returns every node in the tree, depth first', () => {
    const rows = flattenWithAncestry(twoDovers());

    expect(rows.map((r) => r.node.name)).toEqual([
      'United Kingdom', 'Dover', 'United States', 'Dover',
    ]);
  });
});

describe('levelRows', () => {
  it('keeps the name-derived region: the breadcrumb already names the parent', () => {
    const rows = levelRows([node('Buckland Cemetary, Dover', { id: 5 })]);

    expect(rows[0].region).toBe('Dover');
  });
});

describe('matchesQuery', () => {
  it('matches on the full place string, case-insensitively', () => {
    const [row] = levelRows([node('Cannington, Somerset, England')]);

    expect(matchesQuery(row, 'somerset')).toBe(true);
    expect(matchesQuery(row, 'cann')).toBe(true);
    expect(matchesQuery(row, 'kent')).toBe(false);
  });
});

describe('regionFromName', () => {
  it('is empty when the name carries no jurisdiction suffix', () => {
    expect(regionFromName('Dover')).toBe('');
    expect(regionFromName('Dover, Kent')).toBe('Kent');
  });
});
