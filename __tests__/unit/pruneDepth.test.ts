import { describe, it, expect } from 'vitest';
import { treeDepth, pruneTreeDepth, focusMaxDepth, pruneFocusDepth } from '@/lib/tree/pruneDepth';
import type { TreeNode, FocusTrees } from '@/app/components/tree/types';

/** Minimal TreeNode factory — only fields the depth helpers read matter. */
function node(id: number, children: TreeNode[] = []): TreeNode {
  return { id, name: `P${id}`, photoMediaId: null, spouses: [], children };
}

// A 3-generation line: 1 → 2 → 3 → 4  (depth 3)
const line = node(1, [node(2, [node(3, [node(4)])])]);

// A branching tree: root 1 with children 2 (leaf) and 3 (→ 4 → 5)  (depth 3)
const branchy = node(1, [node(2), node(3, [node(4, [node(5)])])]);

describe('treeDepth', () => {
  it('counts generations over the children chain', () => {
    expect(treeDepth(node(1))).toBe(0);
    expect(treeDepth(line)).toBe(3);
    expect(treeDepth(branchy)).toBe(3);
  });
  it('is null/undefined-safe', () => {
    expect(treeDepth(null)).toBe(0);
    expect(treeDepth(undefined)).toBe(0);
  });
});

describe('pruneTreeDepth', () => {
  it('maxDepth 1 keeps only the first generation of children', () => {
    const pruned = pruneTreeDepth(line, 1);
    expect(pruned.children).toHaveLength(1);
    expect(pruned.children![0].id).toBe(2);
    expect(pruned.children![0].children ?? []).toHaveLength(0);
  });

  it('maxDepth 0 drops all children but keeps the root', () => {
    const pruned = pruneTreeDepth(line, 0);
    expect(pruned.id).toBe(1);
    expect(pruned.children).toEqual([]);
  });

  it('maxDepth >= natural depth returns the SAME reference (memo-friendly)', () => {
    expect(pruneTreeDepth(line, 3)).toBe(line);
    expect(pruneTreeDepth(line, 99)).toBe(line);
  });

  it('maxDepth < 0 returns the same reference (show all)', () => {
    expect(pruneTreeDepth(line, -1)).toBe(line);
  });

  it('preserves untouched branches by identity, clones only cut ones', () => {
    // Keep 1 generation: branch "2" (already a leaf) is preserved, "3" is cut.
    const pruned = pruneTreeDepth(branchy, 1);
    const original2 = branchy.children![0];
    const pruned2 = pruned.children!.find((c) => c.id === 2)!;
    const pruned3 = pruned.children!.find((c) => c.id === 3)!;
    expect(pruned2).toBe(original2); // untouched leaf kept by identity
    expect(pruned3.children).toEqual([]); // deeper branch truncated
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(line);
    pruneTreeDepth(line, 1);
    expect(JSON.stringify(line)).toBe(before);
  });
});

describe('focus depth (measured from the focus person)', () => {
  // Realistic stage-D shape:
  //  - left chain rooted at the great-grandfather, leaf = father (leftParentId 11)
  //  - right chain rooted at the grandmother, leaf = mother (rightParentId 21)
  //  - center rooted at the father (11); focus (1) sits at depth 1, then descendants
  const focus: Extract<FocusTrees, { stage: 'D' }> = {
    stage: 'D',
    left: node(100, [node(10, [node(11)])]),        // gt-grandfather → grandfather → father (3 gens up)
    right: node(20, [node(21)]),                     // grandmother → mother (2 gens up)
    center: node(11, [node(1, [node(2, [node(3)])])]), // father → focus → child → grandchild (2 gens down)
    focusPersonId: 1,
    leftParentId: 11,
    rightParentId: 21,
  };

  it('focusMaxDepth is the deepest direction from the focus person', () => {
    // left=3 gens up, right=2, descendants=treeDepth(center)-1=2 → 3
    expect(focusMaxDepth(focus)).toBe(3);
  });

  it('depth 1 = the focus person + parents up + children down (re-rooted chains)', () => {
    const pruned = pruneFocusDepth(focus, 1) as Extract<FocusTrees, { stage: 'D' }>;
    // ancestor chains re-rooted to the parent (nearest the focus), not the oldest ancestor
    expect(pruned.left!.id).toBe(11);
    expect(pruned.left!.children ?? []).toHaveLength(0);
    expect(pruned.right!.id).toBe(21);
    // center keeps father → focus → child, drops the grandchild (2nd descendant gen)
    expect(treeDepth(pruned.center)).toBe(2);
    expect(pruned.center.children![0].id).toBe(1);          // focus still present
    expect(pruned.center.children![0].children![0].id).toBe(2); // one child gen kept
    expect(pruned.center.children![0].children![0].children ?? []).toHaveLength(0); // grandchild cut
  });

  it('depth 2 keeps 2 ancestor gens (re-rooted at the grandparent)', () => {
    const pruned = pruneFocusDepth(focus, 2) as Extract<FocusTrees, { stage: 'D' }>;
    expect(pruned.left!.id).toBe(10);       // grandfather
    expect(pruned.left!.children![0].id).toBe(11); // → father
    expect(pruned.center).toBe(focus.center); // descendants (2 gens) untouched → identity
  });

  it('returns same reference when nothing is cut', () => {
    expect(pruneFocusDepth(focus, 3)).toBe(focus);
    expect(pruneFocusDepth(focus, -1)).toBe(focus);
  });

  it('handles stage A (center rooted at the focus person, no ancestor chains)', () => {
    const a: FocusTrees = { stage: 'A', center: node(1, [node(2, [node(3)])]), focusPersonId: 1 };
    expect(focusMaxDepth(a)).toBe(2);
    const pruned = pruneFocusDepth(a, 1) as Extract<FocusTrees, { stage: 'A' }>;
    expect(treeDepth(pruned.center)).toBe(1);
  });

  // REGRESSION GUARD. Focus side-clusters are grandparent-rooted and BRANCHING —
  // they carry the parent's siblings and their children. #347 briefly made them a
  // pure one-node-per-generation chain; the slider maths must keep working over
  // the branching shape, not just a chain.
  describe('over a branching (grandparent-rooted, collateral-bearing) side cluster', () => {
    // Left cluster: grandfather 10 → { father 11, uncle 12 → cousin 13 }.
    // The focus person's parent (the chain leaf) is the father, 11.
    const branchingLeft = node(10, [node(11), node(12, [node(13)])]);
    const ft: FocusTrees = {
      stage: 'D',
      left: branchingLeft,
      right: null,
      center: node(11, [node(1, [node(2)])]), // parent → focus → child
      leftParentId: 11,
      rightParentId: null,
      focusPersonId: 1,
    };

    it('reports 2 ancestor generations despite the deeper collateral branch', () => {
      // The uncle→cousin branch is 2 levels below the grandfather, but it is
      // COLLATERAL — ancestor depth is measured along the root→leaf(11) path only.
      expect(focusMaxDepth(ft)).toBe(2);
    });

    it('depth 1 re-roots to the parent and drops the collateral branch', () => {
      const pruned = pruneFocusDepth(ft, 1) as Extract<FocusTrees, { stage: 'D' }>;
      expect(pruned.left!.id).toBe(11);                    // re-rooted at the father
      expect(pruned.left!.children ?? []).toHaveLength(0);  // uncle/cousin cut
    });

    it('depth 2 keeps the grandparent AND its collateral breadth', () => {
      const pruned = pruneFocusDepth(ft, 2) as Extract<FocusTrees, { stage: 'D' }>;
      expect(pruned.left!.id).toBe(10);
      expect(pruned.left!.children!.map(c => c.id)).toEqual([11, 12]);
      // The cousin sits one level beyond the 2-generation budget and is trimmed.
      expect(pruned.left!.children![1].children ?? []).toHaveLength(0);
    });
  });
});
