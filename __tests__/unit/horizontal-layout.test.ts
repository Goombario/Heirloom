import { describe, it, expect } from 'vitest';
import { computeStandardLayout } from '@/lib/tree/layout/standardLayout';
import { BAR_CARD_WIDTH } from '@/lib/tree/geometry';
import type { TreeNode, Spouse } from '@/app/components/tree/types';

function person(id: number, name: string, extra: Partial<TreeNode> = {}): TreeNode {
  return { id, name, photoMediaId: null, spouses: [], ...extra };
}
function spouse(id: number, name: string, hasChildren: boolean, extra: Partial<Spouse> = {}): Spouse {
  return { id, name, photoMediaId: null, hasChildren, ...extra };
}

/** Root + one spouse + two children — enough to check the generation and
 *  spouse-stacking invariants after the transpose. */
function descendantsTree(): TreeNode {
  return person(1, 'Root', {
    sex: 'M',
    birthYear: 1900,
    spouses: [spouse(2, 'Wife', true, { sex: 'F', birthYear: 1902 })],
    children: [
      person(10, 'A', { sex: 'M', birthYear: 1925, otherParentId: 2 }),
      person(11, 'B', { sex: 'F', birthYear: 1928, otherParentId: 2 }),
    ],
  });
}

function ancestorsTree(): TreeNode {
  return person(30, 'Kid', {
    sex: 'M',
    birthYear: 1990,
    children: [
      person(40, 'Dad', { sex: 'M', birthYear: 1960 }),
      person(41, 'Mom', { sex: 'F', birthYear: 1962 }),
    ],
  });
}

function pos(out: ReturnType<typeof computeStandardLayout>, personId: number, isSpouse = false) {
  const node = out.nodes.find(
    (n) => (n.data.person as { id: number }).id === personId && !!n.data.isSpouse === isSpouse,
  );
  if (!node) throw new Error(`node ${personId} (spouse=${isSpouse}) not found`);
  return node.position;
}

describe('horizontal layout invariants', () => {
  it('stacks a spouse vertically at the same generation column as their partner', () => {
    const out = computeStandardLayout(descendantsTree(), 'descendants', 'horizontal');
    const root = pos(out, 1);
    const wife = pos(out, 2, true);
    expect(wife.x).toBe(root.x);           // same generation column (same screen-X)
    expect(wife.y).toBeGreaterThan(root.y); // stacked below, not beside
  });

  it('places siblings in one generation column, offset only vertically', () => {
    const out = computeStandardLayout(descendantsTree(), 'descendants', 'horizontal');
    const a = pos(out, 10);
    const b = pos(out, 11);
    expect(a.x).toBe(b.x);        // same column
    expect(a.y).not.toBe(b.y);    // separated vertically
  });

  it('advances generations rightward (children to the +x side of the root)', () => {
    const out = computeStandardLayout(descendantsTree(), 'descendants', 'horizontal');
    expect(pos(out, 10).x).toBeGreaterThan(pos(out, 1).x);
    expect(out.bounds!.maxX - out.bounds!.minX).toBeGreaterThanOrEqual(BAR_CARD_WIDTH);
  });

  it('swaps the generation axis relative to the vertical layout', () => {
    const vertical = computeStandardLayout(descendantsTree(), 'descendants', 'vertical');
    const horizontal = computeStandardLayout(descendantsTree(), 'descendants', 'horizontal');
    // Vertical: a child drops in +y from the root, sharing roughly its column.
    expect(pos(vertical, 10).y).toBeGreaterThan(pos(vertical, 1).y);
    // Horizontal: the same child advances in +x instead — the generation axis moved.
    expect(pos(horizontal, 10).x).toBeGreaterThan(pos(horizontal, 1).x);
  });

  it('anchors ancestors at the left-most column (root flows rightward into the past)', () => {
    const out = computeStandardLayout(ancestorsTree(), 'ancestors', 'horizontal');
    const minX = Math.min(...out.nodes.map((n) => n.position.x));
    expect(pos(out, 30).x).toBe(minX);
    // A parent (previous generation) sits to the right of the root.
    expect(pos(out, 40).x).toBeGreaterThan(pos(out, 30).x);
  });
});
