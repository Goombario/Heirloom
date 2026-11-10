/**
 * Focus-view layout: three column-engine passes (LEFT paternal / RIGHT
 * maternal / CENTER) composed onto one canvas, then per-y-level overlap
 * correction, node deduplication and edge remapping.
 *
 *  - LEFT  (paternal): X-mirrored, fans leftward.
 *  - RIGHT (maternal): normal, fans rightward.
 *  - CENTER: Stage D — rooted at the father with the mother as his spouse and
 *    the focus + siblings as d3 children; Stage A (no parents) — rooted at the
 *    focus person, no side trees.
 *
 * The focus person appears exactly once at the horizontal canvas center.
 * Deduplication priority: CENTER > LEFT > RIGHT. Cross-cluster edges that
 * bypass the center are suppressed.
 */
import type { FocusTrees, TreeNode, FlowNode, FlowEdge, LayoutOutput } from '@/app/components/tree/types';
import {
  PERSON_CARD_WIDTH,
  MIN_BRANCH_GAP,
  FOCUS_Y,
  CENTER_X,
  INNER_GAP,
} from '@/lib/tree/geometry';
import { nodeKeyToId, canonicalNodeId } from '@/lib/tree/keys';
import { computeColumnLayout, layoutBounds } from './columnEngine';

// Stage A fallback anchors for the side trees (Stage D anchors side trees at
// the parents' CENTER positions instead).
const LEFT_X = CENTER_X - INNER_GAP;                       // = -108
const RIGHT_X = CENTER_X + PERSON_CARD_WIDTH + INNER_GAP;  // = +108

// Canonical (dedup) identity comes from the shared NodeKey codec:
// `center-person-4212-spouse0` and `right-person-4212` both canonicalize to
// `person-4212`. The spouse-suffix stripping is what lets Stage D dedup the
// mother-as-spouse inside CENTER against the mother-as-leaf inside RIGHT.
const toCanonical = canonicalNodeId;

export function computeFocusLayout(focusTrees: FocusTrees | null): LayoutOutput {
  if (!focusTrees) {
    return { nodes: [], edges: [], bounds: null, anchor: null };
  }

  const focusId = focusTrees.focusPersonId;
  const isStageD = focusTrees.stage === 'D';

  // Pass 1 — center tree.
  // Stage D: CENTER is rooted at the father. lineageOrder='last' splices the
  //   focus child to the rightmost d3 slot among her siblings, so siblings
  //   line up to her left and her spouse fits naturally on her right. The
  //   father lands one row up at y = -VERTICAL_SPACING with mother as his
  //   spouse beside him.
  // Stage A: focus-person root; lineageOrder='first' is harmless here because
  //   the focus has no siblings inside CENTER.
  const centerResult = computeColumnLayout(focusTrees.center, {
    cluster: 'center',
    focusPersonId: focusId,
    shift: { targetX: CENTER_X, targetY: FOCUS_Y },
    lineageOrder: isStageD ? 'last' : 'first',
  });

  if (!isStageD) {
    // Stage A: only CENTER is populated. Skip the side-tree work entirely.
    // (Node IDs keep their 'center-' prefix here — Stage A never runs dedup.)
    return {
      ...centerResult,
      bounds: layoutBounds(centerResult.nodes),
      anchor: { nodeId: nodeKeyToId({ personId: focusId, role: 'person', cluster: 'center' }), placement: 'center' },
    };
  }

  // Pass 2 — side trees (Stage D only).
  // Side trees are pure ancestor chains terminating at each parent. The
  // parent-leaf is anchored at the parent's CENTER canvas position so it
  // overlaps perfectly with its CENTER duplicate (which dedup removes).
  // Ancestors above each parent fan further up the canvas.
  const leftParentId = focusTrees.leftParentId ?? undefined;
  const rightParentId = focusTrees.rightParentId ?? undefined;

  let leftAnchorX = LEFT_X;
  let leftAnchorY = FOCUS_Y;
  let rightAnchorX = RIGHT_X;
  let rightAnchorY = FOCUS_Y;

  if (centerResult.nodes.length > 0) {
    // Find the parent's canvas position in CENTER — match by person id, not
    // by node id, because in Stage D the father is a main node and the
    // mother is a spouse node (id suffixed with `-spouse0`).
    if (leftParentId != null) {
      const n = centerResult.nodes.find((n) => n.data.person.id === leftParentId);
      if (n) { leftAnchorX = n.position.x; leftAnchorY = n.position.y; }
    }
    if (rightParentId != null) {
      const n = centerResult.nodes.find((n) => n.data.person.id === rightParentId);
      if (n) { rightAnchorX = n.position.x; rightAnchorY = n.position.y; }
    }
  }

  const leftResult = focusTrees.left
    ? computeColumnLayout(focusTrees.left, {
        cluster: 'left',
        mirrorX: true,
        focusPersonId: focusId,
        shift: { targetX: leftAnchorX, targetY: leftAnchorY, anchorPersonId: leftParentId },
      })
    : { nodes: [] as FlowNode[], edges: [] as FlowEdge[] };

  // Pre-trim the right tree: remove any subtree nodes that already exist in
  // the left tree. Paternal and maternal ancestor chains are disjoint by
  // design, so this trim is a no-op in the normal case (safe to leave in
  // for endogamy edge cases).
  const leftNodeIds = new Set<number>();
  function collectLeftIds(node: TreeNode): void {
    leftNodeIds.add(node.id);
    node.spouses?.forEach((s) => leftNodeIds.add(s.id));
    node.children?.forEach(collectLeftIds);
  }
  if (focusTrees.left) collectLeftIds(focusTrees.left);

  function trimSharedFromRight(node: TreeNode): TreeNode {
    const trimmedChildren = (node.children ?? [])
      .filter((c) => c.id === focusId || !leftNodeIds.has(c.id))
      .map(trimSharedFromRight);
    return { ...node, children: trimmedChildren.length > 0 ? trimmedChildren : undefined };
  }
  const trimmedRight = focusTrees.right ? trimSharedFromRight(focusTrees.right) : null;

  const rightResult = trimmedRight
    ? computeColumnLayout(trimmedRight, {
        cluster: 'right',
        focusPersonId: focusId,
        shift: { targetX: rightAnchorX, targetY: rightAnchorY, anchorPersonId: rightParentId },
      })
    : { nodes: [] as FlowNode[], edges: [] as FlowEdge[] };

  // Pass 3 — per-y-level overlap correction.
  // For each side-tree node, if it shares a y-level with center-tree nodes,
  // ensure ≥MIN_BRANCH_GAP between them; if not, shift the entire side tree
  // outward by the worst-case overlap. Cross-cluster pairs are by definition
  // different branches (CENTER's lineage vs the side tree's collateral
  // ancestors / cousins), so the same branch gap d3 uses internally is the
  // right minimum here too.
  //
  // Skip side-tree nodes whose canonical ID also appears in the center tree
  // (the focus person, the focus person's spouses, etc.). These will be
  // dropped by the dedup pass below — counting them produces a phantom
  // overlap with their CENTER-tree counterpart and pushes the side trees
  // unnecessarily far out.
  if (centerResult.nodes.length > 0) {
    const centerCanonicalIds = new Set(
      centerResult.nodes.map((n) => toCanonical(n.id)),
    );

    const centerByY = new Map<number, { minX: number; maxX: number }>();
    for (const n of centerResult.nodes) {
      const y = Math.round(n.position.y);
      const prev = centerByY.get(y) ?? { minX: Infinity, maxX: -Infinity };
      centerByY.set(y, {
        minX: Math.min(prev.minX, n.position.x),
        maxX: Math.max(prev.maxX, n.position.x + PERSON_CARD_WIDTH),
      });
    }

    let leftOverlap = 0;
    for (const n of leftResult.nodes) {
      if (centerCanonicalIds.has(toCanonical(n.id))) continue; // deduped, skip
      const y = Math.round(n.position.y);
      const c = centerByY.get(y);
      if (c) {
        leftOverlap = Math.max(leftOverlap,
          n.position.x + PERSON_CARD_WIDTH + MIN_BRANCH_GAP - c.minX);
      }
    }

    let rightOverlap = 0;
    for (const n of rightResult.nodes) {
      if (centerCanonicalIds.has(toCanonical(n.id))) continue; // deduped, skip
      const y = Math.round(n.position.y);
      const c = centerByY.get(y);
      if (c) {
        rightOverlap = Math.max(rightOverlap,
          c.maxX + MIN_BRANCH_GAP - n.position.x);
      }
    }

    if (leftOverlap > 0) {
      for (const n of leftResult.nodes) n.position.x -= leftOverlap;
    }
    if (rightOverlap > 0) {
      for (const n of rightResult.nodes) n.position.x += rightOverlap;
    }

    // Pass 3b — LEFT ↔ RIGHT separation.
    // Pass 3 only separates each side tree from CENTER. On rows where CENTER
    // has no nodes (typically the grandparent rows), the two side trees can
    // still overlap EACH OTHER — e.g. when the parents sit adjacent as a
    // couple, the paternal tree's spouse cards land exactly where the
    // maternal tree's root lands. Enforce MIN_BRANCH_GAP between the trees
    // per y-level, splitting the correction evenly: LEFT moves further left
    // and RIGHT further right, both of which can only widen the CENTER gaps
    // just enforced above.
    if (leftResult.nodes.length > 0 && rightResult.nodes.length > 0) {
      const leftMaxXByY = new Map<number, number>();
      for (const n of leftResult.nodes) {
        if (centerCanonicalIds.has(toCanonical(n.id))) continue; // deduped, skip
        const y = Math.round(n.position.y);
        leftMaxXByY.set(y, Math.max(leftMaxXByY.get(y) ?? -Infinity, n.position.x + PERSON_CARD_WIDTH));
      }

      let crossOverlap = 0;
      for (const n of rightResult.nodes) {
        if (centerCanonicalIds.has(toCanonical(n.id))) continue; // deduped, skip
        const y = Math.round(n.position.y);
        const leftMaxX = leftMaxXByY.get(y);
        if (leftMaxX !== undefined) {
          crossOverlap = Math.max(crossOverlap, leftMaxX + MIN_BRANCH_GAP - n.position.x);
        }
      }

      if (crossOverlap > 0) {
        const half = crossOverlap / 2;
        for (const n of leftResult.nodes) n.position.x -= half;
        for (const n of rightResult.nodes) n.position.x += half;
      }
    }
  }

  // ── Deduplication ─────────────────────────────────────────────────────
  // Priority: CENTER > LEFT > RIGHT. First occurrence of a canonical ID wins.
  // This means the focus person and their descendants come from the center
  // tree (correct position & spouses), while side-tree duplicates are dropped.
  type Cluster = 'center' | 'left' | 'right';
  const nodeMap = new Map<string, FlowNode>();
  const nodeCluster = new Map<string, Cluster>();

  for (const [result, cluster] of [
    [centerResult, 'center'],
    [leftResult, 'left'],
    [rightResult, 'right'],
  ] as [typeof centerResult, Cluster][]) {
    for (const node of result.nodes) {
      const cid = toCanonical(node.id);
      if (!nodeMap.has(cid)) {
        nodeMap.set(cid, { ...node, id: cid });
        nodeCluster.set(cid, cluster);
      }
    }
  }

  // ── Edge remapping + deduplication ────────────────────────────────────
  // Remap source/target to canonical IDs, then:
  //  1. Drop edges whose endpoints were removed by dedup (node doesn't exist).
  //  2. Drop cross-cluster edges where neither endpoint is in the center
  //     cluster. These are sibling-of-focus edges that would span the full
  //     canvas width.
  const edgeSeen = new Set<string>();
  const edges: FlowEdge[] = [];

  for (const edge of [
    ...centerResult.edges,
    ...leftResult.edges,
    ...rightResult.edges,
  ]) {
    const src = toCanonical(edge.source);
    const tgt = toCanonical(edge.target);

    if (!nodeMap.has(src) || !nodeMap.has(tgt)) continue;

    const srcCluster = nodeCluster.get(src);
    const tgtCluster = nodeCluster.get(tgt);
    if (
      srcCluster !== tgtCluster &&
      srcCluster !== 'center' &&
      tgtCluster !== 'center'
    ) continue;

    const key = `${src}→${tgt}`;
    if (!edgeSeen.has(key)) {
      edgeSeen.add(key);
      edges.push({ ...edge, id: `edge-${src}-${tgt}`, source: src, target: tgt });
    }
  }

  // Note: the pre-refactor hook carried a "Stage A parent marriage line"
  // block here, guarded by `!isStageD` — unreachable, because Stage A already
  // returned right after Pass 1 (parents imply Stage D in the API). It was
  // dropped in the port; in Stage D the parents are a normal couple inside
  // CENTER, so their spouse edge and child edges come from Pass 1 directly.

  const nodes = Array.from(nodeMap.values());
  return {
    nodes,
    edges,
    bounds: layoutBounds(nodes),
    // Post-dedup IDs are canonical, so the focus card is `person-<id>`.
    anchor: { nodeId: nodeKeyToId({ personId: focusId, role: 'person' }), placement: 'center' },
  };
}
