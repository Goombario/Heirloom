import { describe, it, expect } from 'vitest';
import { hierarchy, tree as d3tree } from 'd3-hierarchy';
import {
  PERSON_CARD_WIDTH,
  SPOUSE_GAP,
  MIN_SIBLING_GAP,
  MIN_BRANCH_GAP,
  VERTICAL_SPACING,
  INNER_GAP,
  FOCUS_Y,
  CENTER_X,
} from '@/lib/tree/geometry';
// The REAL production separation + mirror functions — not local replicas.
// (An earlier version of this file re-implemented the separation formula and
// had silently drifted from production in the cousin/apportion case.)
import { columnSeparation, mirrorLeftEdge as mirrorLeft } from '@/lib/tree/layout/columnEngine';
import { computeFocusLayout } from '@/lib/tree/layout/focusLayout';
import type { TreeNode, Spouse, FocusTrees } from '@/app/components/tree/types';

interface TestNode { id: string; width: number; children?: TestNode[] }

function runSeparation(root: TestNode, mirrorX: boolean) {
  const hier = hierarchy<TestNode>(root, d => d.children);
  const layout = d3tree<TestNode>()
    .nodeSize([1, VERTICAL_SPACING])
    .separation((a, b) => columnSeparation(a.data.width, b.data.width, a.parent === b.parent, mirrorX));
  layout(hier);
  return hier;
}

// ── Constant consistency ──────────────────────────────────────────────────────

describe('useFocusTreeLayout constants', () => {
  it('LEFT_X and RIGHT_X are derived correctly from CENTER_X and INNER_GAP', () => {
    const LEFT_X = CENTER_X - INNER_GAP;
    const RIGHT_X = CENTER_X + PERSON_CARD_WIDTH + INNER_GAP;
    // CENTER_X=-48, PERSON_CARD_WIDTH=96, INNER_GAP=60
    expect(LEFT_X).toBe(-108);
    expect(RIGHT_X).toBe(108);
  });

  it('FOCUS_Y is zero (focus person anchored at canvas origin)', () => {
    expect(FOCUS_Y).toBe(0);
  });

  it('CENTER_X is the negative half-width of the card', () => {
    expect(CENTER_X).toBe(-48);
  });
});

// ── Separation formula — mirrored (left/paternal) tree ────────────────────────

describe('separation formula — mirrored tree', () => {
  // Reproduces the Wendy/Simon/Mark/Claire case from sep-debug.ts:
  // Simon has a spouse (width=212), Mark and Claire do not (width=96).
  // After mirroring, Simon is the rightmost child (innermost), Mark and Claire fan left.
  // The gap between each adjacent sibling pair should be exactly MIN_SIBLING_GAP.
  const root: TestNode = {
    id: 'Wendy',
    width: PERSON_CARD_WIDTH + SPOUSE_GAP + PERSON_CARD_WIDTH, // 212
    children: [
      { id: 'Simon', width: PERSON_CARD_WIDTH + SPOUSE_GAP + PERSON_CARD_WIDTH }, // 212
      { id: 'Mark',  width: PERSON_CARD_WIDTH },  // 96
      { id: 'Claire',width: PERSON_CARD_WIDTH },  // 96
    ],
  };

  it('produces exactly MIN_SIBLING_GAP between all siblings after mirroring', () => {
    const hier = runSeparation(root, true);
    const children = hier.children!;

    // After mirroring: left edge = -(rawX - 48 + 96) = -(rawX + 48)
    const positions = children.map(n => ({
      id: n.data.id,
      canvasLeft: mirrorLeft(n.x! - PERSON_CARD_WIDTH / 2),
      width: n.data.width,
    })).sort((a, b) => a.canvasLeft - b.canvasLeft);

    for (let i = 0; i < positions.length - 1; i++) {
      const rightEdge = positions[i].canvasLeft + positions[i].width;
      const leftEdge = positions[i + 1].canvasLeft;
      expect(leftEdge - rightEdge).toBe(MIN_SIBLING_GAP);
    }
  });

  it('produces LARGER than MIN_SIBLING_GAP with the old Math.max formula (confirms fix)', () => {
    const hier = hierarchy<TestNode>(root, d => d.children);
    d3tree<TestNode>()
      .nodeSize([1, VERTICAL_SPACING])
      .separation((a, b) => Math.max(a.data.width, b.data.width) + MIN_SIBLING_GAP)
      (hier);

    const children = hier.children!;
    const positions = children.map(n => ({
      id: n.data.id,
      canvasLeft: mirrorLeft(n.x! - PERSON_CARD_WIDTH / 2),
      width: n.data.width,
    })).sort((a, b) => a.canvasLeft - b.canvasLeft);

    let anyOversized = false;
    for (let i = 0; i < positions.length - 1; i++) {
      const gap = positions[i + 1].canvasLeft - (positions[i].canvasLeft + positions[i].width);
      if (gap > MIN_SIBLING_GAP) anyOversized = true;
    }
    expect(anyOversized).toBe(true);
  });
});

// ── Separation formula — normal (right/maternal) tree ────────────────────────

describe('separation formula — normal tree', () => {
  // Percy's children: Marjorie(96), Dorothy+Percy(212), Ronald(96), Peggy+Dennis(212)
  const root: TestNode = {
    id: 'Percy',
    width: PERSON_CARD_WIDTH + SPOUSE_GAP + PERSON_CARD_WIDTH, // 212
    children: [
      { id: 'Marjorie',      width: PERSON_CARD_WIDTH },
      { id: 'DorothyPercy', width: PERSON_CARD_WIDTH + SPOUSE_GAP + PERSON_CARD_WIDTH },
      { id: 'Ronald',        width: PERSON_CARD_WIDTH },
      { id: 'PeggyDennis',  width: PERSON_CARD_WIDTH + SPOUSE_GAP + PERSON_CARD_WIDTH },
    ],
  };

  it('produces exactly MIN_SIBLING_GAP between all siblings (no mirror)', () => {
    const hier = runSeparation(root, false);
    const children = hier.children!;

    const positions = children.map(n => ({
      id: n.data.id,
      canvasLeft: n.x! - PERSON_CARD_WIDTH / 2,
      width: n.data.width,
    })).sort((a, b) => a.canvasLeft - b.canvasLeft);

    for (let i = 0; i < positions.length - 1; i++) {
      const gap = positions[i + 1].canvasLeft - (positions[i].canvasLeft + positions[i].width);
      expect(gap).toBe(MIN_SIBLING_GAP);
    }
  });
});

// ── X-mirror formula ──────────────────────────────────────────────────────────

describe('X-mirror transform', () => {
  it('left edge of mirrored card = -(rawLeft + CARD_WIDTH)', () => {
    // rawLeft = d3X - 48; mirrored = -(rawLeft + 96) = -d3X - 48
    const rawLeft = 100;
    expect(mirrorLeft(rawLeft)).toBe(-(rawLeft + PERSON_CARD_WIDTH));
  });

  it('mirroring is its own inverse (double-mirror returns to original)', () => {
    // mirror twice: mirror(-(x + W)) = -(-(x+W) + W) = x + W - W = x
    const rawLeft = 50;
    const once = mirrorLeft(rawLeft);
    const twice = mirrorLeft(once);
    expect(twice).toBe(rawLeft);
  });

  it('innermost (first-sorted) child becomes rightmost after mirror', () => {
    const root: TestNode = {
      id: 'Parent', width: PERSON_CARD_WIDTH,
      children: [
        { id: 'FocusChild', width: PERSON_CARD_WIDTH }, // sorted first = leftmost in d3
        { id: 'Sibling',    width: PERSON_CARD_WIDTH },
      ],
    };
    const hier = runSeparation(root, true);
    const [first, second] = hier.children!;
    const firstCanvas  = mirrorLeft(first.x!  - PERSON_CARD_WIDTH / 2);
    const secondCanvas = mirrorLeft(second.x! - PERSON_CARD_WIDTH / 2);
    // After mirror, d3's "first" (leftmost/most-negative) becomes rightmost
    expect(firstCanvas).toBeGreaterThan(secondCanvas);
  });
});

// ── Pass 3: per-y-level overlap detection ────────────────────────────────────
// Mirrors the Pass 3 logic in lib/tree/layout/focusLayout.ts, which enforces
// MIN_BRANCH_GAP (cross-cluster pairs are different branches by definition).

describe('Pass 3 overlap correction logic', () => {
  interface NodePos { x: number; y: number; id: number; isSelected?: boolean }

  function computeOverlap(
    sideNodes: NodePos[],
    centerByY: Map<number, { minX: number; maxX: number }>,
    focusId: number,
    side: 'left' | 'right',
  ): number {
    let overlap = 0;
    for (const n of sideNodes) {
      if (n.id === focusId) continue;
      const y = Math.round(n.y);
      const c = centerByY.get(y);
      if (!c) continue;
      const candidate = side === 'left'
        ? n.x + PERSON_CARD_WIDTH + MIN_BRANCH_GAP - c.minX
        : c.maxX + MIN_BRANCH_GAP - n.x;
      if (candidate > overlap) overlap = candidate;
    }
    return overlap;
  }

  it('detects no overlap when side tree is clear of center tree', () => {
    const centerByY = new Map([[0, { minX: -48, maxX: 48 }]]);
    const leftNodes = [{ x: -400, y: 0, id: 1 }];
    expect(computeOverlap(leftNodes, centerByY, 99, 'left')).toBeLessThanOrEqual(0);
  });

  it('detects overlap when left node encroaches on center', () => {
    // Left node right edge at -48 + 96 = 48; center minX = 0 → overlap = 48 + MIN_BRANCH_GAP
    const centerByY = new Map([[0, { minX: 0, maxX: 200 }]]);
    const leftNodes = [{ x: -48, y: 0, id: 1 }]; // right edge = -48+96 = 48
    const overlap = computeOverlap(leftNodes, centerByY, 99, 'left');
    expect(overlap).toBe(48 + MIN_BRANCH_GAP - 0);
  });

  it('skips the focus person node when computing overlap', () => {
    const centerByY = new Map([[0, { minX: 0, maxX: 200 }]]);
    const leftNodes = [{ x: -48, y: 0, id: 42 }]; // focus person — should be skipped
    const overlap = computeOverlap(leftNodes, centerByY, 42, 'left');
    expect(overlap).toBe(0);
  });

  it('detects overlap when right node encroaches on center', () => {
    // Center maxX=100; right node at x=120 → overlap = 100 + MIN_BRANCH_GAP - 120
    const centerByY = new Map([[0, { minX: -200, maxX: 100 }]]);
    const rightNodes = [{ x: 120, y: 0, id: 2 }];
    const overlap = computeOverlap(rightNodes, centerByY, 99, 'right');
    expect(overlap).toBe(100 + MIN_BRANCH_GAP - 120);
  });
});

// ── Pass 3b: LEFT ↔ RIGHT side-tree separation (computeFocusLayout) ──────────
// Regression: with the parents adjacent as a couple in CENTER, the side trees
// anchor 116px apart, so the paternal tree's grandparent spouse card used to
// land exactly under the maternal tree's grandparent root card.

describe('Pass 3b — side trees do not overlap each other', () => {
  function person(id: number, name: string, extra: Partial<TreeNode> = {}): TreeNode {
    return { id, name, photoMediaId: null, spouses: [], ...extra };
  }
  function spouse(id: number, name: string, hasChildren: boolean, extra: Partial<Spouse> = {}): Spouse {
    return { id, name, photoMediaId: null, hasChildren, ...extra };
  }

  // Same shape that reproduced the overlap in the app: 3 generations, both
  // grandparent couples one row above the parents.
  const focusTrees: FocusTrees = {
    stage: 'D',
    focusPersonId: 102,
    leftParentId: 100,
    rightParentId: 101,
    center: person(100, 'Father', {
      sex: 'M', birthYear: 1945,
      spouses: [spouse(101, 'Mother', true, { sex: 'F', birthYear: 1947 })],
      children: [
        person(102, 'Focus', {
          sex: 'F', birthYear: 1970, otherParentId: 101,
          spouses: [spouse(103, 'Spouse', true, { sex: 'M', birthYear: 1969 })],
          children: [person(110, 'Kid', { sex: 'M', birthYear: 1995, otherParentId: 103 })],
        }),
        person(104, 'Sibling', { sex: 'M', birthYear: 1968, otherParentId: 101 }),
      ],
    }),
    left: person(120, 'GrandpaP', {
      sex: 'M', birthYear: 1920,
      spouses: [spouse(121, 'GrandmaP', true, { sex: 'F', birthYear: 1922 })],
      children: [person(100, 'Father', { sex: 'M', birthYear: 1945, otherParentId: 121 })],
    }),
    right: person(130, 'GrandpaM', {
      sex: 'M', birthYear: 1921,
      spouses: [spouse(131, 'GrandmaM', true, { sex: 'F', birthYear: 1923 })],
      children: [person(101, 'Mother', { sex: 'F', birthYear: 1947, otherParentId: 131 })],
    }),
  };

  const LEFT_IDS = new Set(['person-120', 'person-121']);
  const RIGHT_IDS = new Set(['person-130', 'person-131']);

  it('keeps ≥ MIN_BRANCH_GAP between LEFT and RIGHT nodes on shared rows', () => {
    const { nodes } = computeFocusLayout(focusTrees);
    const leftNodes = nodes.filter((n) => LEFT_IDS.has(n.id));
    const rightNodes = nodes.filter((n) => RIGHT_IDS.has(n.id));
    expect(leftNodes.length).toBeGreaterThan(0);
    expect(rightNodes.length).toBeGreaterThan(0);

    const leftMaxRight = Math.max(...leftNodes.map((n) => n.position.x + PERSON_CARD_WIDTH));
    const rightMinLeft = Math.min(...rightNodes.map((n) => n.position.x));
    expect(rightMinLeft - leftMaxRight).toBeGreaterThanOrEqual(MIN_BRANCH_GAP);
  });

  it('keeps the focus person anchored at (CENTER_X, FOCUS_Y)', () => {
    const { nodes } = computeFocusLayout(focusTrees);
    const focus = nodes.find((n) => n.id === 'person-102' && !n.data.isSpouse);
    expect(focus).toBeDefined();
    expect(focus!.position.x).toBeCloseTo(CENTER_X, 5);
    expect(focus!.position.y).toBeCloseTo(FOCUS_Y, 5);
  });

  it('splits the correction between the two sides (both trees move)', () => {
    // Without Pass 3b, GrandpaP's spouse card (121) right edge sat at x=86 and
    // GrandpaM (130) at x=-10 — overlapping. With the split shift, LEFT must
    // end left of its unshifted extent and RIGHT right of its unshifted one.
    const { nodes } = computeFocusLayout(focusTrees);
    const grandmaP = nodes.find((n) => n.id === 'person-121')!;
    const grandpaM = nodes.find((n) => n.id === 'person-130')!;
    expect(grandmaP.position.x + PERSON_CARD_WIDTH).toBeLessThan(-10);
    expect(grandpaM.position.x).toBeGreaterThan(86 - PERSON_CARD_WIDTH);
  });
});
