/**
 * The single d3-hierarchy column layout engine behind every tree mode.
 *
 * Both client layout paths (`useTreeLayout` for descendants/ancestors,
 * `useFocusTreeLayout` for the three-tree focus composition) previously carried
 * near-identical private copies of this logic, which had already drifted in
 * subtle ways (and their test/debug-script replicas had drifted further).
 * This module is the one implementation; callers parameterize it instead of
 * forking it.
 *
 * Coordinate conventions (canvas space, px):
 *  - A card's position is its TOP-LEFT corner; cards are
 *    PERSON_CARD_WIDTH × PERSON_CARD_HEIGHT.
 *  - d3 lays out main cards on generation rows VERTICAL_SPACING apart; spouse
 *    cards share their main card's row, extending to the right (to the left in
 *    a pre-mirror frame for mirrored trees — the X-flip puts them back on the
 *    right).
 *  - orientation 'down': root row at y=0, children below. orientation 'up'
 *    (ancestors): Y is inverted so the deepest ancestors sit at y=0 and the
 *    root person lands on the bottom row.
 *  - mirrorX reflects card left-edges through x=0 (used by the focus mode
 *    paternal tree so it fans leftward): mirrored_left_edge = -(rawX + CARD_W).
 *  - An optional `shift` then translates the whole tree so a chosen anchor
 *    person's card lands at (targetX, targetY).
 */
import { hierarchy, tree } from 'd3-hierarchy';
import type { TreeNode, Spouse, FlowNode, FlowEdge, LayoutResult, LayoutBounds } from '@/app/components/tree/types';
import {
  PERSON_CARD_WIDTH,
  PERSON_CARD_HEIGHT,
  BAR_CARD_WIDTH,
  MIN_SIBLING_GAP,
  MIN_BRANCH_GAP,
  BRANCH_COLORS,
  DEFAULT_LAYOUT_GEOMETRY,
  type LayoutGeometry,
} from '@/lib/tree/geometry';
import { nodeKeyToId, clusterPrefix, type FocusCluster } from '@/lib/tree/keys';

/** Layout metadata written onto the input nodes during a pass. */
interface ExtendedTreeNode extends TreeNode {
  _width?: number;
  _branchColor?: string;
}

export interface ColumnLayoutOptions {
  /** Focus-mode subtree this column belongs to (prefixes node/edge IDs). */
  cluster?: FocusCluster;
  /**
   * 'down' (default): root on top, children flow downward, child edges leave
   * the bottom handle. 'up' (ancestors): Y inverted, child edges leave the top
   * handle, and the matrilineal edge-source rule is disabled (edges between
   * generations point at ancestors, not children).
   */
  orientation?: 'down' | 'up';
  /** Flip the X axis (focus mode's paternal tree fans leftward). */
  mirrorX?: boolean;
  /** Mark the d3 root card as selected (descendants/ancestors modes). */
  selectRoot?: boolean;
  /**
   * Focus person id (focus mode): every card of this person is marked
   * selected, and it is the fallback for lineage marking and anchor shifting.
   * Also enables the lineage splice pass.
   */
  focusPersonId?: number;
  /**
   * Translate the finished layout so `anchorPersonId`'s main card (fallback:
   * the focus person's) lands at (targetX, targetY). Omit for no shift.
   */
  shift?: { targetX: number; targetY?: number; anchorPersonId?: number };
  /**
   * Where to splice the lineage child (the path toward the anchor person)
   * among its siblings: 'first' = innermost/leftmost in d3 space (side trees),
   * 'last' = rightmost (Stage D center, so siblings sit left of the focus).
   * Only applies when focusPersonId is set.
   */
  lineageOrder?: 'first' | 'last';
  /**
   * Card footprint + spacing to lay out against. Defaults to the portrait
   * constants; horizontal mode passes bar geometry. See lib/tree/geometry.ts.
   */
  geometry?: LayoutGeometry;
}

/**
 * d3 separation callback shared by all modes. Exported so tests and debug
 * tooling exercise the real production formula instead of a copy.
 *
 * d3-hierarchy uses two different argument orderings:
 *   firstWalk (siblings):  separation(rightSibling, leftSibling)  → a=right, b=left
 *   apportion (cousins):   separation(leftContour,  rightContour) → a=left,  b=right
 * The "encroaching" width is the spouse cards extending into the gap. In d3
 * space (pre-mirror) spouses extend rightward for normal trees and leftward
 * for mirrored trees, so the relevant width flips with mirrorX.
 */
export function columnSeparation(
  aWidth: number,
  bWidth: number,
  isSibling: boolean,
  mirrorX: boolean,
  gaps: { sibling: number; branch: number } = { sibling: MIN_SIBLING_GAP, branch: MIN_BRANCH_GAP },
): number {
  const gap = isSibling ? gaps.sibling : gaps.branch;
  const leftWidth = isSibling ? bWidth : aWidth;
  const rightWidth = isSibling ? aWidth : bWidth;
  return (mirrorX ? rightWidth : leftWidth) + gap;
}

/** X-mirror transform: reflect a card's left edge through x=0. */
export function mirrorLeftEdge(rawX: number): number {
  return -(rawX + PERSON_CARD_WIDTH);
}

/** Bounding box of positioned cards (card extents included); null when empty.
 *  `dims` defaults to the portrait footprint; horizontal mode passes bar dims. */
export function layoutBounds(
  nodes: FlowNode[],
  dims: { width: number; height: number } = { width: PERSON_CARD_WIDTH, height: PERSON_CARD_HEIGHT },
): LayoutBounds | null {
  if (nodes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
    if (n.position.x + dims.width > maxX) maxX = n.position.x + dims.width;
    if (n.position.y + dims.height > maxY) maxY = n.position.y + dims.height;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Transpose a vertical column-engine result into a horizontal (left-to-right)
 * bar layout: swap each node's x/y (generation → horizontal, sibling spread →
 * vertical, so spouses stack), retype nodes to `personBar`, and rewrite edge
 * handles (parent→child left↔right, spouse connectors top↔bottom).
 *
 * The engine must have been run with HORIZONTAL_BAR_GEOMETRY so the pre-swap
 * spread extent already carries the bar height.
 *
 * `mirror` (ancestors): the naive swap lands the root on the right; reflect the
 * generation axis so the root sits on the left and generations flow rightward
 * into the past. Reflection uses BAR_CARD_WIDTH to keep card footprints intact.
 *
 * Branch/parent-child edge handles are chosen from the endpoints' final X
 * positions rather than assumed: for a normal parent→child edge the target is
 * to the +x side, but ancestor-mode SIBLING edges run parent→sibling where the
 * parent (source) sits to the RIGHT of the sibling — so the handle must follow
 * geometry, not a fixed rule.
 */
export function transposeToHorizontal(
  result: LayoutResult,
  opts: { mirror: boolean },
): LayoutResult {
  const nodes: FlowNode[] = result.nodes.map((n) => ({
    ...n,
    type: 'personBar',
    position: opts.mirror
      ? { x: -(n.position.y + BAR_CARD_WIDTH), y: n.position.x }
      : { x: n.position.y, y: n.position.x },
  }));

  const xById = new Map(nodes.map((n) => [n.id, n.position.x]));
  const edges: FlowEdge[] = result.edges.map((e) => {
    if (e.type === 'spouse') {
      return {
        ...e,
        sourceHandle: 'bottom',
        targetHandle: 'top-target',
        data: { ...(e.data ?? {}), laneAxis: 'y' as const },
      };
    }
    // Route from whichever side actually faces the other node. Handle ids match
    // PersonBarNode's four-sided set (source: right/left-source, target: left/right-target).
    const srcX = xById.get(e.source) ?? 0;
    const tgtX = xById.get(e.target) ?? 0;
    const targetIsRight = tgtX >= srcX;
    return {
      ...e,
      sourceHandle: targetIsRight ? 'right' : 'left-source',
      targetHandle: targetIsRight ? 'left' : 'right-target',
    };
  });
  return { nodes, edges };
}

/**
 * Lay out one tree column: annotate widths and branch colors, sort children by
 * birth year, optionally splice the lineage child to an edge of its sibling
 * group, run d3-tree, then emit React Flow nodes (person + spouse cards) and
 * edges (spouse connectors + parent-child branches).
 */
export function computeColumnLayout(rootNode: TreeNode, opts: ColumnLayoutOptions = {}): LayoutResult {
  const {
    cluster,
    orientation = 'down',
    mirrorX = false,
    selectRoot = false,
    focusPersonId,
    shift,
    lineageOrder = 'first',
    geometry = DEFAULT_LAYOUT_GEOMETRY,
  } = opts;
  const prefix = clusterPrefix(cluster);

  const root = hierarchy<ExtendedTreeNode>(rootNode as ExtendedTreeNode, (d) => d.children);

  const spousesWithKids = (spouses: Spouse[] | undefined): Spouse[] =>
    spouses?.filter((s) => s.hasChildren) ?? [];

  // ── Sort children by birth year at every level ────────────────────────────
  // In d3, the first child gets the smallest (leftmost / most-negative) X.
  // Ascending keeps siblings oldest-to-youngest left-to-right; mirrored trees
  // reverse the sort so the canvas still reads oldest-on-the-left after the
  // X-flip. Unknown birth years sort to the outer end; the sort is stable so
  // ties preserve DB order.
  root.eachBefore((node) => {
    if (!node.children || node.children.length <= 1) return;
    node.children.sort((a, b) => {
      const aYear = a.data.birthYear ?? Number.POSITIVE_INFINITY;
      const bYear = b.data.birthYear ?? Number.POSITIVE_INFINITY;
      return mirrorX ? bYear - aYear : aYear - bYear;
    });
  });

  // ── Lineage marking + splice (focus mode) ─────────────────────────────────
  // Mark the path from the root to the anchor person, then splice the lineage
  // child to the requested edge of its sibling group so Stage D dedup doesn't
  // leave an empty mid-cluster slot and Pass 3 doesn't over-shift side trees.
  if (focusPersonId !== undefined) {
    const lineageMarkerId = shift?.anchorPersonId ?? focusPersonId;
    const lineageIds = new Set<number>();
    const markLineage = (n: { data: ExtendedTreeNode; children?: typeof root.children }): boolean => {
      if (n.data.id === lineageMarkerId) { lineageIds.add(n.data.id); return true; }
      for (const c of n.children ?? []) {
        if (markLineage(c)) { lineageIds.add(n.data.id); return true; }
      }
      return false;
    };
    markLineage(root);

    root.eachBefore((node) => {
      if (!node.children || node.children.length <= 1) return;
      const idx = node.children.findIndex((c) => lineageIds.has(c.data.id));
      if (idx < 0) return;
      if (lineageOrder === 'first' && idx > 0) {
        const [child] = node.children.splice(idx, 1);
        node.children.unshift(child);
      } else if (lineageOrder === 'last' && idx < node.children.length - 1) {
        const [child] = node.children.splice(idx, 1);
        node.children.push(child);
      }
    });
  }

  // ── Width annotation ──────────────────────────────────────────────────────
  root.each((node) => {
    const count = node.data.spouses?.length || 0;
    node.data._width = geometry.spreadExtent + count * (geometry.spreadExtent + geometry.spouseGap);
  });

  // ── Branch-color annotation ───────────────────────────────────────────────
  // Parents with 2+ child-bearing spouses get a block of global color offsets
  // so different family groups never reuse the same rotation slots; each child
  // is colored by which spouse is its other parent. The color stops there: a
  // grandchild's edge is the plain tree edge again (#462, ADR 0032), matching
  // the BranchEdge shape markers, which only appear on a multi-spouse parent's
  // own child edges.
  let globalColorCounter = 0;
  const parentColorOffsets = new Map<number, number>();
  root.eachBefore((node) => {
    const cb = spousesWithKids(node.data.spouses);
    if (cb.length > 1) {
      parentColorOffsets.set(node.data.id, globalColorCounter);
      globalColorCounter += cb.length;
    }
  });
  root.eachBefore((node) => {
    if (!node.parent) { node.data._branchColor = undefined; return; }
    const parentData = node.parent.data;
    const parentCB = spousesWithKids(parentData.spouses);
    const idx = parentCB.length > 1 ? parentCB.findIndex((s) => s.id === node.data.otherParentId) : -1;
    const offset = parentColorOffsets.get(parentData.id) ?? 0;
    node.data._branchColor = idx >= 0 ? BRANCH_COLORS[(offset + idx) % BRANCH_COLORS.length] : undefined;
  });

  // ── d3 tree layout ────────────────────────────────────────────────────────
  const treeLayout = tree<ExtendedTreeNode>()
    .nodeSize([1, geometry.generationSpacing])
    .separation((a, b) => columnSeparation(
      a.data._width || geometry.spreadExtent,
      b.data._width || geometry.spreadExtent,
      a.parent === b.parent,
      mirrorX,
      { sibling: geometry.minSiblingGap, branch: geometry.minBranchGap },
    ));
  treeLayout(root);

  // Ancestors mode: collect max Y so rows can be inverted (deepest on top).
  let maxY = 0;
  if (orientation === 'up') {
    root.each((node) => {
      const y = node.y ?? 0;
      if (y > maxY) maxY = y;
    });
  }

  // ── Emit raw nodes and edges ──────────────────────────────────────────────
  interface RawNode {
    id: string;
    rawX: number;
    rawY: number;
    data: FlowNode['data'];
    isSpouseNode: boolean;
  }
  const rawNodes: RawNode[] = [];
  const edges: FlowEdge[] = [];

  const isSelectedFor = (personId: number, isRoot: boolean): boolean =>
    selectRoot ? isRoot : focusPersonId !== undefined && personId === focusPersonId;

  root.each((node) => {
    const personData = node.data;
    const d3X = node.x ?? 0;
    const rawY0 = node.y ?? 0;
    const rawY = orientation === 'up' ? maxY - rawY0 : rawY0;
    const mainX = d3X - geometry.spreadExtent / 2;
    const isRootNode = !node.parent;

    rawNodes.push({
      id: nodeKeyToId({ personId: personData.id, role: 'person', cluster }),
      rawX: mainX,
      rawY,
      data: {
        person: personData,
        isSpouse: false,
        isSelected: isSelectedFor(personData.id, isRootNode),
      },
      isSpouseNode: false,
    });

    // Spouse cards + connectors
    if (personData.spouses && personData.spouses.length > 0) {
      const totalSpouses = personData.spouses.length;
      personData.spouses.forEach((sp, idx) => {
        // Pre-mirror frame: spouses extend left in mirrored trees so the
        // X-flip lands them to the right of their main card, same as normal.
        const spouseX = mirrorX
          ? mainX - (idx + 1) * (geometry.spreadExtent + geometry.spouseGap)
          : mainX + geometry.spreadExtent + geometry.spouseGap + idx * (geometry.spreadExtent + geometry.spouseGap);

        rawNodes.push({
          id: nodeKeyToId({ personId: sp.id, role: 'spouse', spouseIndex: idx, cluster }),
          rawX: spouseX,
          rawY,
          data: {
            person: sp,
            isSpouse: true,
            spouseIndex: idx,
            parentPersonId: personData.id,
            ...(focusPersonId !== undefined ? { isSelected: sp.id === focusPersonId } : {}),
          },
          isSpouseNode: true,
        });

        // Connector color: multi-childbearing-spouse nodes color each lane by
        // spouse; otherwise plain, even on a branch-coloured child (#1180): the
        // child's line from its parent carries the branch, not its own marriage.
        const cbSpouses = spousesWithKids(personData.spouses);
        const multiSpouse = cbSpouses.length > 1;
        const cbIdx = cbSpouses.findIndex((s) => s.id === sp.id);
        const colorOffset = parentColorOffsets.get(personData.id) ?? 0;
        const connectorColor = multiSpouse && cbIdx >= 0
          ? BRANCH_COLORS[(colorOffset + cbIdx) % BRANCH_COLORS.length]
          : 'var(--color-tree-edge)';

        // Spouse cards always end up to the RIGHT of their main card on canvas
        // (mirrored trees pre-flip), so connectors always run right→left.
        edges.push({
          id: `${prefix}spouse-${personData.id}-${sp.id}-${idx}`,
          source: nodeKeyToId({ personId: personData.id, role: 'person', cluster }),
          target: nodeKeyToId({ personId: sp.id, role: 'spouse', spouseIndex: idx, cluster }),
          type: 'spouse',
          style: { stroke: connectorColor, strokeWidth: 4, strokeDasharray: sp.hasChildren ? '0' : '5,5' },
          data: { spouseIndex: idx, totalSpouses },
          sourceHandle: 'right',
          targetHandle: 'left',
        });
      });
    }

    // Parent → child edge
    if (node.parent) {
      const childData = node.data;
      const parentData = node.parent.data;
      const parentCB = spousesWithKids(parentData.spouses);
      const parentMultiSpouse = parentCB.length > 1;

      let sourceId = nodeKeyToId({ personId: parentData.id, role: 'person', cluster });
      let shapeIndex = 0;

      if (parentMultiSpouse && childData.otherParentId && parentData.spouses) {
        // Multi-spouse: connect from the specific spouse so branches read apart.
        const spouseIdx = parentData.spouses.findIndex((s) => s.id === childData.otherParentId);
        if (spouseIdx !== -1) {
          sourceId = nodeKeyToId({ personId: childData.otherParentId, role: 'spouse', spouseIndex: spouseIdx, cluster });
          shapeIndex = spouseIdx;
        }
      } else if (orientation === 'down' && !parentMultiSpouse && parentCB.length === 1) {
        // Single child-bearing spouse: flow from the female partner. Use the
        // child-bearing list to skip non-child-bearing spouses, then look up
        // her real index so the node ID suffix is correct.
        const sp = parentCB[0];
        const spIdx = parentData.spouses?.findIndex((s) => s.id === sp.id) ?? -1;
        if (parentData.sex !== 'F' && sp.sex === 'F') {
          sourceId = nodeKeyToId({ personId: sp.id, role: 'spouse', spouseIndex: spIdx >= 0 ? spIdx : 0, cluster });
          shapeIndex = 0;
        }
      }

      edges.push({
        id: `${prefix}edge-${sourceId}-person-${childData.id}`,
        source: sourceId,
        target: nodeKeyToId({ personId: childData.id, role: 'person', cluster }),
        type: parentMultiSpouse ? 'branch' : 'smoothstep',
        style: { stroke: childData._branchColor || 'var(--color-tree-edge)', strokeWidth: 4 },
        ...(parentMultiSpouse ? { data: { shapeIndex } } : {}),
        sourceHandle: orientation === 'up' ? 'top' : 'bottom',
        targetHandle: orientation === 'up' ? 'bottom-target' : 'top-target',
      });
    }
  });

  // ── Mirror X (paternal/left focus tree) ───────────────────────────────────
  if (mirrorX) {
    for (const n of rawNodes) {
      n.rawX = mirrorLeftEdge(n.rawX);
    }
  }

  // ── Shift so the anchor person lands at (targetX, targetY) ────────────────
  let shiftX = 0;
  let shiftY = 0;
  if (shift) {
    const anchorId = shift.anchorPersonId ?? focusPersonId;
    const anchorNode =
      rawNodes.find((n) => !n.isSpouseNode && (n.data.person as { id: number }).id === anchorId) ??
      rawNodes.find((n) => !n.isSpouseNode && (n.data.person as { id: number }).id === focusPersonId);
    shiftX = shift.targetX - (anchorNode?.rawX ?? 0);
    shiftY = (shift.targetY ?? 0) - (anchorNode?.rawY ?? 0);
  }

  const nodes: FlowNode[] = rawNodes.map((n) => ({
    id: n.id,
    type: 'person',
    position: { x: n.rawX + shiftX, y: n.rawY + shiftY },
    data: n.data,
  }));

  return { nodes, edges };
}
