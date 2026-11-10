import { describe, it, expect } from 'vitest';
import { findNodeById, ancestorsOf, selectResult } from '@/app/places/explore/useExploreState';
import type { PlaceTreeNode } from '@/lib/places/hierarchy';

function n(id: number, name: string, children: PlaceTreeNode[] = []): PlaceTreeNode {
  const node: PlaceTreeNode = {
    id, name, parentId: null, ownCount: 0, rolledCount: 0, peopleCount: 0,
    faces: [], latitude: null, longitude: null, pinSuppressed: false, pinState: 'none', children,
  };
  for (const c of children) c.parentId = id;
  return node;
}

// England(1) → [ Kent(2) → [ Dover(3), Folkestone(4) → [ Foord(5) ] ], London(6) ]
function fixture(): PlaceTreeNode[] {
  const dover = n(3, 'Dover');
  const foord = n(5, 'Foord');
  const folkestone = n(4, 'Folkestone', [foord]);
  const kent = n(2, 'Kent', [dover, folkestone]);
  const london = n(6, 'London');
  return [n(1, 'England', [kent, london])];
}

describe('findNodeById', () => {
  it('finds a nested node', () => {
    expect(findNodeById(fixture(), 5)?.name).toBe('Foord');
    expect(findNodeById(fixture(), 1)?.name).toBe('England');
  });
  it('returns null for a missing id or null', () => {
    expect(findNodeById(fixture(), 99)).toBeNull();
    expect(findNodeById(fixture(), null)).toBeNull();
  });
});

describe('ancestorsOf', () => {
  it('returns the root→node path inclusive', () => {
    expect(ancestorsOf(fixture(), 5).map((x) => x.name)).toEqual(['England', 'Kent', 'Folkestone', 'Foord']);
    expect(ancestorsOf(fixture(), 1).map((x) => x.name)).toEqual(['England']);
  });
  it('is empty for null', () => {
    expect(ancestorsOf(fixture(), null)).toEqual([]);
  });
});

describe('selectResult', () => {
  it('selecting a parent drills in (currentNode = that node)', () => {
    const kent = findNodeById(fixture(), 2)!;
    expect(selectResult(kent, 1)).toEqual({ selectedId: 2, currentNodeId: 2 });
  });
  it('selecting a leaf keeps the current level (siblings stay listed)', () => {
    const dover = findNodeById(fixture(), 3)!;
    expect(selectResult(dover, 2)).toEqual({ selectedId: 3, currentNodeId: 2 });
  });
});
