import { describe, it, expect, vi } from 'vitest';

// The layout hooks wrap pure computation in useMemo. Replace useMemo with a
// direct call so the hooks can be exercised as plain functions — this keeps the
// test on the hooks' public API, so it guards the exact output the tree
// renders, before and after any internal refactor of the layout engine.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useMemo: <T,>(fn: () => T) => fn() };
});

import { useTreeLayoutMode } from '@/app/components/tree/useTreeLayoutMode';
import type { TreeNode, Spouse, FocusTrees, LayoutResult } from '@/app/components/tree/types';

// ── Fixture helpers ──────────────────────────────────────────────────────────

function person(id: number, name: string, extra: Partial<TreeNode> = {}): TreeNode {
  return { id, name, photoMediaId: null, spouses: [], ...extra };
}

function spouse(id: number, name: string, hasChildren: boolean, extra: Partial<Spouse> = {}): Spouse {
  return { id, name, photoMediaId: null, hasChildren, ...extra };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Compact, deterministic projection of a LayoutResult for snapshotting.
 *  Positions rounded; person objects reduced to their id (the full TreeNode
 *  object graph would bloat snapshots without adding signal).
 *  Note: sidebar selection is a post-layout decoration (TreeVisualization),
 *  not a layout output, so it does not appear here. */
function project({ nodes, edges }: LayoutResult) {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      x: round2(n.position.x),
      y: round2(n.position.y),
      personId: (n.data.person as { id: number }).id,
      isSpouse: !!n.data.isSpouse,
      ...(n.data.spouseIndex !== undefined ? { spouseIndex: n.data.spouseIndex } : {}),
      ...(n.data.parentPersonId !== undefined ? { parentPersonId: n.data.parentPersonId } : {}),
      isSelected: !!n.data.isSelected,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      stroke: e.style?.stroke,
      dash: e.style?.strokeDasharray,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      ...(e.data !== undefined ? { data: e.data } : {}),
    })),
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Descendants tree exercising: multi-childbearing-spouse branch colors +
 *  branch edges + shape indexes, a non-childbearing spouse, birth-year sibling
 *  sorting with an unknown year, and the matrilineal edge-source rule
 *  (male parent + single childbearing female spouse → edge from her card). */
function multiSpouseTree(): TreeNode {
  return person(1, 'Alan', {
    sex: 'M',
    birthYear: 1928,
    spouses: [
      spouse(2, 'Betty', true, { sex: 'F', birthYear: 1930 }),
      spouse(3, 'Carol', true, { sex: 'F', birthYear: 1935 }),
      spouse(4, 'Dora', false, { sex: 'F' }),
    ],
    children: [
      person(10, 'Ed', {
        sex: 'M',
        birthYear: 1955,
        otherParentId: 2,
        spouses: [spouse(11, 'Fay', true, { sex: 'F', birthYear: 1957 })],
        children: [person(20, 'Gil', { sex: 'M', birthYear: 1980, otherParentId: 11 })],
      }),
      person(12, 'Hal', { sex: 'M', birthYear: 1950, otherParentId: 3 }),
      person(13, 'Ida', { sex: 'F', otherParentId: 2 }), // unknown birthYear → sorted last
    ],
  });
}

/** Ancestors tree: `children` holds PARENTS (the buildAncestorNode convention);
 *  root carries spouses + siblings (with connectingParentId). */
function ancestorsTree(): TreeNode {
  return person(30, 'Zed', {
    sex: 'M',
    birthYear: 1990,
    spouses: [spouse(32, 'Yara', false, { sex: 'F' })],
    siblings: [
      {
        id: 31, name: 'Wilma', photoMediaId: null, sex: 'F',
        birthYear: 1988, connectingParentId: 40,
      },
      {
        id: 33, name: 'Vince', photoMediaId: null, sex: 'M',
        connectingParentId: 40, // unknown birthYear → sorted after Wilma
      },
    ],
    children: [
      person(40, 'Dad', {
        sex: 'M',
        birthYear: 1960,
        children: [
          person(50, 'GrandpaP', { sex: 'M', birthYear: 1930 }),
          person(51, 'GrandmaP', { sex: 'F', birthYear: 1932 }),
        ],
      }),
      person(41, 'Mom', { sex: 'F', birthYear: 1962 }),
    ],
  });
}

/** Focus Stage D: center rooted at the father (mother as spouse; focus + one
 *  sibling as children; focus has own spouse + child), plus paternal/maternal
 *  ancestor chains terminating at each parent (deduped into CENTER). */
function focusStageD(): FocusTrees {
  return {
    stage: 'D',
    focusPersonId: 102,
    leftParentId: 100,
    rightParentId: 101,
    center: person(100, 'Frank', {
      sex: 'M',
      birthYear: 1945,
      spouses: [spouse(101, 'Mona', true, { sex: 'F', birthYear: 1947 })],
      children: [
        person(102, 'Fiona', {
          sex: 'F',
          birthYear: 1970,
          otherParentId: 101,
          spouses: [spouse(103, 'Sam', true, { sex: 'M', birthYear: 1969 })],
          children: [person(110, 'Kid', { sex: 'M', birthYear: 1995, otherParentId: 103 })],
        }),
        person(104, 'Bro', { sex: 'M', birthYear: 1968, otherParentId: 101 }),
      ],
    }),
    left: person(120, 'GrandpaP', {
      sex: 'M',
      birthYear: 1920,
      spouses: [spouse(121, 'GrandmaP', true, { sex: 'F', birthYear: 1922 })],
      children: [person(100, 'Frank', { sex: 'M', birthYear: 1945, otherParentId: 121 })],
    }),
    right: person(130, 'GrandpaM', {
      sex: 'M',
      birthYear: 1921,
      spouses: [spouse(131, 'GrandmaM', true, { sex: 'F', birthYear: 1923 })],
      children: [person(101, 'Mona', { sex: 'F', birthYear: 1947, otherParentId: 131 })],
    }),
  };
}

/** Focus Stage A: no parents — center rooted at the focus person. */
function focusStageA(): FocusTrees {
  return {
    stage: 'A',
    focusPersonId: 200,
    center: person(200, 'Solo', {
      sex: 'F',
      birthYear: 1980,
      spouses: [spouse(201, 'Mate', true, { sex: 'M', birthYear: 1978 })],
      children: [person(210, 'Junior', { sex: 'F', birthYear: 2005, otherParentId: 201 })],
    }),
  };
}

// ── Golden snapshots (captured from the pre-refactor hooks) ──────────────────

describe('tree layout parity', () => {
  it('descendants mode — multi-spouse colors, sorting, matrilineal edge source', () => {
    expect(project(useTreeLayoutMode('descendants', { tree: multiSpouseTree() }))).toMatchSnapshot();
  });

  it('colours only a multi-spouse parent\'s direct children, not the generation below (#462)', () => {
    const { edges } = useTreeLayoutMode('descendants', { tree: multiSpouseTree() });
    const intoPerson = (id: number) => edges.find((e) => e.id.startsWith('edge-') && e.id.endsWith(`-person-${id}`))!;
    // Ed (Betty's son) and Hal (Carol's son) keep their mothers' colours…
    expect(intoPerson(10).style?.stroke).toMatch(/^#/);
    expect(intoPerson(12).style?.stroke).toMatch(/^#/);
    expect(intoPerson(12).style?.stroke).not.toBe(intoPerson(10).style?.stroke);
    // …but Ed's own son is a plain tree edge again, with no shape marker.
    expect(intoPerson(20).style?.stroke).toBe('var(--color-tree-edge)');
    expect(intoPerson(20).type).toBe('smoothstep');
    // Ed's line to his own wife Fay is plain too (#1180); Alan's lanes stay coloured.
    expect(edges.find((e) => e.id.startsWith('spouse-10-11-'))!.style?.stroke).toBe('var(--color-tree-edge)');
    expect(edges.find((e) => e.id.startsWith('spouse-1-2-'))!.style?.stroke).toMatch(/^#/);
  });

  it('ancestors mode — inverted Y, sibling injection, top/bottom handles', () => {
    expect(project(useTreeLayoutMode('ancestors', { tree: ancestorsTree() }))).toMatchSnapshot();
  });

  it('focus mode — Stage D three-tree composition with dedup', () => {
    expect(project(useTreeLayoutMode('focus', { focusTrees: focusStageD() }))).toMatchSnapshot();
  });

  it('focus mode — Stage A center-only fallback', () => {
    expect(project(useTreeLayoutMode('focus', { focusTrees: focusStageA() }))).toMatchSnapshot();
  });

  it('empty inputs produce empty layouts', () => {
    expect(useTreeLayoutMode('descendants', { tree: null })).toEqual({ nodes: [], edges: [], bounds: null, anchor: null });
    expect(useTreeLayoutMode('focus', { focusTrees: null })).toEqual({ nodes: [], edges: [], bounds: null, anchor: null });
  });

  it('unknown mode IDs fall back to the descendants layout', () => {
    const known = useTreeLayoutMode('descendants', { tree: multiSpouseTree() });
    const unknown = useTreeLayoutMode('fan-chart-not-yet', { tree: multiSpouseTree() });
    expect(project(unknown)).toEqual(project(known));
  });

  it('declares the viewport anchor + bounds for each mode', () => {
    const desc = useTreeLayoutMode('descendants', { tree: multiSpouseTree() });
    expect(desc.anchor).toEqual({ nodeId: 'person-1', placement: 'top' });

    const anc = useTreeLayoutMode('ancestors', { tree: ancestorsTree() });
    expect(anc.anchor).toEqual({ nodeId: 'person-30', placement: 'bottom' });

    const focD = useTreeLayoutMode('focus', { focusTrees: focusStageD() });
    expect(focD.anchor).toEqual({ nodeId: 'person-102', placement: 'center' });

    // Stage A never runs dedup, so its node IDs keep the 'center-' prefix.
    const focA = useTreeLayoutMode('focus', { focusTrees: focusStageA() });
    expect(focA.anchor).toEqual({ nodeId: 'center-person-200', placement: 'center' });
    expect(focA.nodes.some((n) => n.id === 'center-person-200')).toBe(true);

    for (const out of [desc, anc, focD, focA]) {
      expect(out.bounds).not.toBeNull();
      expect(out.bounds!.minX).toBeLessThan(out.bounds!.maxX);
      expect(out.bounds!.minY).toBeLessThan(out.bounds!.maxY);
      // The anchor node must exist in the layout it was declared for.
      expect(out.nodes.some((n) => n.id === out.anchor!.nodeId)).toBe(true);
    }
  });
});

describe('horizontal orientation', () => {
  it('descendants — transposed bar layout snapshot', () => {
    expect(project(useTreeLayoutMode('descendants', { tree: multiSpouseTree(), orientation: 'horizontal' }))).toMatchSnapshot();
  });

  it('ancestors — transposed bar layout snapshot', () => {
    expect(project(useTreeLayoutMode('ancestors', { tree: ancestorsTree(), orientation: 'horizontal' }))).toMatchSnapshot();
  });

  it('renders every node as personBar with axis-swapped edge handles', () => {
    const out = useTreeLayoutMode('descendants', { tree: multiSpouseTree(), orientation: 'horizontal' });
    expect(out.nodes.length).toBeGreaterThan(0);
    expect(out.nodes.every((n) => n.type === 'personBar')).toBe(true);

    const spouseEdges = out.edges.filter((e) => e.type === 'spouse');
    expect(spouseEdges.length).toBeGreaterThan(0);
    expect(spouseEdges.every((e) => e.sourceHandle === 'bottom' && e.targetHandle === 'top-target')).toBe(true);
    expect(spouseEdges.every((e) => (e.data as { laneAxis?: string } | undefined)?.laneAxis === 'y')).toBe(true);

    const branchEdges = out.edges.filter((e) => e.type === 'branch' || e.type === 'smoothstep');
    expect(branchEdges.length).toBeGreaterThan(0);
    expect(branchEdges.every((e) => e.sourceHandle === 'right' && e.targetHandle === 'left')).toBe(true);
  });

  it('anchors on the root card, left-pinned, with bar-sized bounds', () => {
    const out = useTreeLayoutMode('descendants', { tree: multiSpouseTree(), orientation: 'horizontal' });
    expect(out.anchor).toEqual({ nodeId: 'person-1', placement: 'left' });
    expect(out.bounds).not.toBeNull();
    expect(out.bounds!.maxX - out.bounds!.minX).toBeGreaterThanOrEqual(188);
  });

  it('places the ancestors root at the left-most x (root flows rightward into the past)', () => {
    const out = useTreeLayoutMode('ancestors', { tree: ancestorsTree(), orientation: 'horizontal' });
    const rootNode = out.nodes.find((n) => n.id === 'person-30')!;
    const minX = Math.min(...out.nodes.map((n) => n.position.x));
    expect(rootNode.position.x).toBe(minX);
  });

  it('leaves vertical layouts identical to the orientation default', () => {
    const omitted = project(useTreeLayoutMode('descendants', { tree: multiSpouseTree() }));
    const explicit = project(useTreeLayoutMode('descendants', { tree: multiSpouseTree(), orientation: 'vertical' }));
    expect(omitted).toEqual(explicit);
  });
});
