/**
 * Descendants / ancestors layout: one column-engine pass plus, in ancestors
 * mode, injection of the root person's siblings (they arrive as `siblings`
 * metadata on the root rather than as d3 children, because the d3 `children`
 * field holds PARENTS in ancestors mode).
 *
 * `orientation: 'horizontal'` runs the same engine with bar geometry, then
 * transposes the whole result to a left-to-right bar layout (see
 * transposeToHorizontal). Sibling injection happens in the pre-transpose
 * (vertical) frame so the transpose carries it along.
 */
import type { TreeNode, FlowNode, FlowEdge, LayoutOutput } from '@/app/components/tree/types';
import {
  DEFAULT_LAYOUT_GEOMETRY,
  HORIZONTAL_BAR_GEOMETRY,
  BAR_CARD_WIDTH,
  BAR_CARD_HEIGHT,
} from '@/lib/tree/geometry';
import { nodeKeyToId } from '@/lib/tree/keys';
import { computeColumnLayout, layoutBounds, transposeToHorizontal } from './columnEngine';

export function computeStandardLayout(
  rootNode: TreeNode | null,
  mode: 'descendants' | 'ancestors' = 'descendants',
  orientation: 'vertical' | 'horizontal' = 'vertical',
): LayoutOutput {
  if (!rootNode) {
    return { nodes: [], edges: [], bounds: null, anchor: null };
  }

  const horizontal = orientation === 'horizontal';
  const geometry = horizontal ? HORIZONTAL_BAR_GEOMETRY : DEFAULT_LAYOUT_GEOMETRY;

  const { nodes, edges } = computeColumnLayout(rootNode, {
    orientation: mode === 'ancestors' ? 'up' : 'down',
    selectRoot: true,
    geometry,
  });

  // Ancestor mode: place the root person's siblings at the same generation,
  // to the left of the root, with a dashed edge from the connecting parent.
  if (mode === 'ancestors' && rootNode.siblings && rootNode.siblings.length > 0) {
    const rootFlowNode = nodes.find((n) => n.id === nodeKeyToId({ personId: rootNode.id, role: 'person' }));
    if (rootFlowNode) {
      const rootLeft = rootFlowNode.position.x;
      const rootY = rootFlowNode.position.y;

      // Sort siblings by birth year so they render left-to-right in birth
      // order. Stable sort: unknown birthYear → end of list, ties keep DB order.
      const sortedSiblings = [...rootNode.siblings].sort((a, b) => {
        const aYear = a.birthYear ?? Number.POSITIVE_INFINITY;
        const bYear = b.birthYear ?? Number.POSITIVE_INFINITY;
        return aYear - bYear;
      });
      sortedSiblings.forEach((sibling, idx) => {
        const siblingX = rootLeft - (idx + 1) * (geometry.spreadExtent + geometry.minSiblingGap);
        const siblingNodeId = nodeKeyToId({ personId: sibling.id, role: 'sibling' });

        nodes.push({
          id: siblingNodeId,
          type: 'person',
          position: { x: siblingX, y: rootY },
          data: {
            person: {
              id: sibling.id,
              name: sibling.name,
              photoMediaId: sibling.photoMediaId,
              focalX: sibling.focalX,
              focalY: sibling.focalY,
              focalRadius: sibling.focalRadius,
              sex: sibling.sex,
              lifespan: sibling.lifespan,
              age: sibling.age,
              isDeceased: sibling.isDeceased,
              spouses: [],
            },
            isSpouse: false,
            isSelected: false,
          },
        } satisfies FlowNode);

        // Edge from the connecting parent node down to the sibling
        const parentNodeId = nodeKeyToId({ personId: sibling.connectingParentId, role: 'person' });
        if (nodes.some((n) => n.id === parentNodeId)) {
          edges.push({
            id: `sibling-edge-${sibling.connectingParentId}-${sibling.id}`,
            source: parentNodeId,
            target: siblingNodeId,
            type: 'smoothstep',
            style: { stroke: 'var(--color-tree-edge)', strokeWidth: 4 },
            sourceHandle: 'bottom',
            targetHandle: 'top-target',
          } satisfies FlowEdge);
        }
      });
    }
  }

  // Horizontal: transpose the finished vertical layout to a left-to-right bar
  // tree. Root sits on the left in both directions (ancestors reflect the
  // generation axis). Anchor pins the root to the viewport's left edge so wide
  // trees always start reading from the root.
  if (horizontal) {
    const t = transposeToHorizontal({ nodes, edges }, { mirror: mode === 'ancestors' });
    return {
      nodes: t.nodes,
      edges: t.edges,
      bounds: layoutBounds(t.nodes, { width: BAR_CARD_WIDTH, height: BAR_CARD_HEIGHT }),
      anchor: {
        nodeId: nodeKeyToId({ personId: rootNode.id, role: 'person' }),
        placement: 'left',
      },
    };
  }

  // Viewport anchor: the root person's card — pinned to the top edge in
  // descendants mode, the bottom edge in ancestors mode (Y is inverted there,
  // so the root person is on the bottom row).
  return {
    nodes,
    edges,
    bounds: layoutBounds(nodes),
    anchor: {
      nodeId: nodeKeyToId({ personId: rootNode.id, role: 'person' }),
      placement: mode === 'ancestors' ? 'bottom' : 'top',
    },
  };
}
