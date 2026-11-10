'use client';

import React, { useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useStore,
  NodeTypes,
  EdgeTypes,
  ReactFlowProvider,
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Search } from '@/lib/icons';

import PersonNode from './PersonNode';
import PersonBarNode from './PersonBarNode';
import BranchEdge from './BranchEdge';
import SpouseEdge from './SpouseEdge';
import { useTreeLayoutMode } from './useTreeLayoutMode';
import { TreeNode, FocusTrees } from './types';
import { PERSON_CARD_WIDTH, PERSON_CARD_HEIGHT, BAR_CARD_WIDTH, BAR_CARD_HEIGHT } from '@/lib/tree/geometry';
import { naturalFitZoom, READABLE_ZOOM } from '@/lib/tree/fitView';
import DebugOverlay from './DebugOverlay';

/**
 * Live zoom-level badge rendered inside the React Flow canvas.
 * Reads the transform directly from the React Flow store so it updates
 * on every pan/zoom without any extra state management.
 */
function ZoomIndicator() {
  const zoom = useStore((s) => s.transform[2]);
  const pct  = Math.round(zoom * 100);

  return (
    <Panel position="top-right" style={{ margin: '10px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          padding: '4px 9px 4px 7px',
          background: 'color-mix(in srgb, var(--color-card) 88%, transparent)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          border: '1px solid var(--color-border)',
          borderRadius: '7px',
          boxShadow: '0 1px 3px color-mix(in srgb, var(--color-border) 60%, transparent)',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        {/* Magnifying-glass icon in muted colour */}
        <Search
          width={11}
          height={11}
          stroke="var(--color-text-muted)"
          strokeWidth={2.2}
          style={{ flexShrink: 0 }}
          aria-hidden="true"
        />

        {/* Percentage — re-keyed on each change to replay the tick animation */}
        <span
          key={pct}
          style={{
            fontVariantNumeric: 'tabular-nums',
            fontSize: '11px',
            fontWeight: 500,
            color: 'var(--color-text-muted)',
            minWidth: '3ch',
            textAlign: 'right',
            lineHeight: 1,
            animation: 'zoom-tick 0.18s ease-out both',
          }}
        >
          {pct}%
        </span>
      </div>
    </Panel>
  );
}

// Above this node count the minimap stops being useful AND becomes harmful (#193 #3):
// on a large, zoomed-out tree its per-node rects shrink to sub-pixel and — because
// `onlyRenderVisibleElements` leaves off-screen nodes unmounted/unmeasured — it renders
// effectively blank, while a fixed bottom-right overlay still covers 1–2 real cards.
// Hiding it past the threshold turns a blank, obstructing panel into simply absent. The
// deeper React Flow fix (give minimap nodes measured dimensions so they draw when culled)
// is a separate investigation tracked in #193.
const MINIMAP_MAX_NODES = 300;

/**
 * Register custom node types
 */
const nodeTypes: NodeTypes = {
  person: PersonNode,
  personBar: PersonBarNode,
};

/**
 * Register custom edge types
 */
const edgeTypes: EdgeTypes = {
  branch: BranchEdge,
  spouse: SpouseEdge,
};

interface TreeVisualizationProps {
  treeData: TreeNode;
  mode?: 'descendants' | 'ancestors' | 'focus';
  /** Card orientation for descendants/ancestors (focus is always vertical). */
  orientation?: 'vertical' | 'horizontal';
  focusTrees?: FocusTrees;
  onReady?: (instance: ReactFlowInstance) => void;
  onPersonClick?: (id: number) => void;
  onPersonDoubleClick?: (id: number) => void;
  onPaneClick?: () => void;
  sidebarSelectedId?: number | null;
  colorblindMode?: boolean;
  showAgeIndicator?: boolean;
  /** DEBUG (bar review): zoom threshold for the bar's name-only mode. */
  barZoomThreshold?: number;
  /** Increment this to trigger a fitView; silent reloads should NOT increment it. */
  fitViewVersion?: number;
  /** True while a JPEG export is in progress — disables viewport virtualization
   *  so the off-screen nodes are mounted for the full-tree capture. */
  isExporting?: boolean;
}

/**
 * TreeVisualization Component
 *
 * Main React Flow container that displays the family tree.
 * Uses custom PersonNode components and d3-hierarchy layout.
 *
 * Features:
 * - Zoom/pan interactions
 * - Custom person card nodes
 * - Smooth edge connections
 * - Minimap and controls
 */
function TreeVisualizationInner({ treeData, mode = 'descendants', orientation = 'vertical', focusTrees, onReady, onPersonClick, onPersonDoubleClick, onPaneClick, sidebarSelectedId, colorblindMode = false, showAgeIndicator = false, barZoomThreshold = 0.6, fitViewVersion = 0, isExporting = false }: TreeVisualizationProps) {
  const [debugMode, setDebugMode] = React.useState(false);

  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'development' && !process.env.NEXT_PUBLIC_DEBUG_OVERLAY) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'd' && e.key !== 'D') return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      setDebugMode((prev) => !prev);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // One dispatch through the layout-mode registry — no per-mode branching
  // here. Focus data wins when present; 'focus' without focusTrees degrades
  // to a descendants layout (matching the registry's own fallback).
  // Note: sidebar selection is NOT a layout input — it is decorated onto the
  // nodes in the effect below, so opening the sidebar never re-runs d3.
  const layoutModeId = focusTrees ? 'focus' : (mode === 'focus' ? 'descendants' : mode);
  const { nodes: layoutNodes, edges: layoutEdges, bounds, anchor } = useTreeLayoutMode(
    layoutModeId,
    { tree: focusTrees ? null : treeData, focusTrees, orientation },
  );

  // React Flow state management
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Theme-aware colors for React Flow components
  const [bgColor, setBgColor] = React.useState('#ddd');
  const [nodeColor, setNodeColor] = React.useState('#3b82f6');

  // Store React Flow instance for fitView
  const reactFlowInstanceRef = React.useRef<ReactFlowInstance | null>(null);

  // Track fitViewVersion to only fitView when explicitly requested by the parent
  const prevFitViewVersionRef = React.useRef<number>(-1);

  // Ref to the container div — dimensions read inside fitViewWithAnchor at call
  // time to avoid stale-closure races with the React Flow store width/height.
  const containerDivRef = React.useRef<HTMLDivElement | null>(null);

  // Hidden until the viewport has been positioned — prevents the tree from
  // flashing in at the wrong location before the anchor-based fit runs.
  const [isPositioned, setIsPositioned] = React.useState(false);

  /**
   * Smart fit-view that horizontally centers on the layout's declared anchor
   * node (root, leaf, or focus person) and pins it vertically per the anchor's
   * placement, at READABLE_ZOOM. This only applies when the whole tree would fit
   * only below that zoom, where card names turn unreadable (FL-1). Trees that fit
   * at a readable zoom keep the default fitView centering.
   *
   * `bounds` and `anchor` come from the layout output — the renderer does not
   * recompute bounding boxes or re-derive per-mode anchor policy.
   */
  const fitViewWithAnchor = useCallback((instance: ReactFlowInstance, animated = true) => {
    if (!bounds || !anchor) {
      instance.fitView({ padding: 0.2, duration: animated ? 200 : 0, minZoom: READABLE_ZOOM });
      return;
    }

    const CARD_W        = orientation === 'horizontal' ? BAR_CARD_WIDTH : PERSON_CARD_WIDTH;
    const CARD_H        = orientation === 'horizontal' ? BAR_CARD_HEIGHT : PERSON_CARD_HEIGHT;
    const FIT_PADDING   = 0.2;

    // Read from the DOM ref at call time — avoids stale closure if the React
    // Flow store hasn't measured the container yet when the callback was created.
    const w = containerDivRef.current?.clientWidth  || window.innerWidth;
    const h = containerDivRef.current?.clientHeight || window.innerHeight;

    // Zoom that would let the whole tree fill the viewport with padding (capped at 2x).
    const naturalZoom = naturalFitZoom(bounds, w, h, FIT_PADDING, 2);

    // If the whole tree fits at a readable zoom, center it on the full bounding box
    // rather than anchoring. READABLE_ZOOM is a single viewport-independent value
    // (naturalZoom already accounts for canvas size) — see lib/tree/fitView.ts.
    if (naturalZoom >= READABLE_ZOOM) {
      instance.fitView({ padding: FIT_PADDING, duration: animated ? 200 : 0, minZoom: READABLE_ZOOM, maxZoom: 2 });
      return;
    }

    // Tree only fits whole below a readable zoom — open on the anchor instead.
    const allNodes = instance.getNodes();
    const anchorNode =
      allNodes.find(n => n.id === anchor.nodeId) ??
      // Fallback (anchor id missing from the rendered set): use the vertical
      // extreme that matches the placement.
      (allNodes.length
        ? allNodes.reduce((a, b) => {
            if (anchor.placement === 'left') return a.position.x <= b.position.x ? a : b;
            return (anchor.placement === 'bottom' ? a.position.y >= b.position.y : a.position.y <= b.position.y) ? a : b;
          })
        : null);
    if (!anchorNode) {
      instance.fitView({ padding: FIT_PADDING, duration: animated ? 200 : 0, minZoom: READABLE_ZOOM });
      return;
    }

    const zoom = READABLE_ZOOM;
    const VERT_PAD = 60;
    const HORIZ_PAD = 60;

    // Horizontal placement: 'left' pins the anchor to the viewport's left edge
    // (wide horizontal trees read from the root rightward); everything else
    // centers the anchor horizontally.
    const targetX =
      anchor.placement === 'left'
        ? HORIZ_PAD - anchorNode.position.x * zoom
        : w / 2 - (anchorNode.position.x + CARD_W / 2) * zoom;

    // Position the anchor vertically per the layout-declared placement
    // ('left' and 'center' both center vertically).
    const targetY =
      anchor.placement === 'top'
        ? VERT_PAD - anchorNode.position.y * zoom
        : anchor.placement === 'bottom'
          ? h - VERT_PAD - CARD_H * zoom - anchorNode.position.y * zoom
          : h / 2 - (anchorNode.position.y + CARD_H / 2) * zoom; // center / left

    instance.setViewport({ x: targetX, y: targetY, zoom }, { duration: animated ? 200 : 0 });
  }, [bounds, anchor, orientation]);

  // Latest sidebar selection kept in a ref so the full-rebuild effect below can
  // stamp the initial isSidebarSelected without depending on sidebarSelectedId —
  // selection changes are applied surgically by a separate effect, so opening
  // the sidebar never rebuilds every node's data object. Synced in an effect
  // (not during render) and declared before the rebuild effect, so on any commit
  // that changes both selection and layout the ref is current before the rebuild
  // reads it; on a layout-only rebuild (e.g. a silent reload after a sidebar
  // edit) the ref retains the still-open selection so its highlight is preserved.
  const sidebarSelectedIdRef = React.useRef(sidebarSelectedId);
  React.useEffect(() => {
    sidebarSelectedIdRef.current = sidebarSelectedId;
  }, [sidebarSelectedId]);

  // Full (re)decoration of the pure layout output with interaction state
  // (callbacks, display prefs). Runs only when the layout, callbacks, display
  // prefs, or an explicit fit-view request change — NOT on sidebar selection —
  // because it rebuilds every node's data (new identity), re-rendering all
  // cards. Decoration is post-layout, so none of it is a layout input: it never
  // re-runs d3.
  React.useEffect(() => {
    const selectedId = sidebarSelectedIdRef.current;
    const nodesWithCallback = layoutNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isSidebarSelected: selectedId != null && node.data.person.id === selectedId,
        onPersonClick,
        onPersonDoubleClick,
        showAgeIndicator,
        barZoomThreshold,
      },
    }));
    setNodes(nodesWithCallback);

    // Inject colorblindMode into branch edges so the custom edge renderer can show/hide shapes
    const edgesWithMode = layoutEdges.map((edge) =>
      edge.type === 'branch'
        ? { ...edge, data: { ...edge.data, colorblindMode } }
        : edge
    );
    setEdges(edgesWithMode);

    // Only fitView when the parent explicitly requests it (non-silent reloads)
    if (fitViewVersion !== prevFitViewVersionRef.current) {
      prevFitViewVersionRef.current = fitViewVersion;
      setIsPositioned(false); // hide while the new layout settles
      setTimeout(() => {
        const inst = reactFlowInstanceRef.current;
        if (inst) fitViewWithAnchor(inst, false); // no animation — tree is hidden
        requestAnimationFrame(() => setIsPositioned(true));
      }, 50);
    }
  }, [layoutNodes, layoutEdges, setNodes, setEdges, onPersonClick, onPersonDoubleClick, colorblindMode, showAgeIndicator, barZoomThreshold, fitViewVersion, fitViewWithAnchor]);

  // Surgical selection update: flip isSidebarSelected only on the nodes whose
  // selection state actually changed (previously- and newly-selected), leaving
  // every other node's object identity intact so memoized PersonNodes skip the
  // re-render. Opening/closing the sidebar now touches at most two cards.
  React.useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        const selected = sidebarSelectedId != null && node.data.person.id === sidebarSelectedId;
        if (!!node.data.isSidebarSelected === selected) return node;
        return { ...node, data: { ...node.data, isSidebarSelected: selected } };
      }),
    );
  }, [sidebarSelectedId, setNodes]);

  // Read CSS variables and update on theme change
  React.useEffect(() => {
    const updateColors = () => {
      const root = getComputedStyle(document.documentElement);
      setBgColor(root.getPropertyValue('--color-border-light').trim() || '#ddd');
      setNodeColor(root.getPropertyValue('--color-primary').trim() || '#3b82f6');
    };

    updateColors();

    // Listen for theme changes
    const observer = new MutationObserver(updateColors);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  // Handle React Flow initialization
  const onInit = useCallback(
    (instance: ReactFlowInstance) => {
      reactFlowInstanceRef.current = instance;
      if (onReady) {
        onReady(instance);
      }
      fitViewWithAnchor(instance, false); // no animation — tree is still hidden
      requestAnimationFrame(() => setIsPositioned(true));
    },
    [onReady, fitViewWithAnchor]
  );

  // Stable identity so the MiniMap (which redraws a rect per node on pan/zoom)
  // isn't handed a new nodeColor function every render.
  const miniMapNodeColor = useCallback(() => nodeColor, [nodeColor]);

  return (
    <div
      ref={containerDivRef}
      // tree-canvas + --tree-panel-inset: the person sidebar is an overlay on the
      // canvas's right edge, so it covered the minimap and the zoom badge. The
      // right-hand React Flow panels slide clear by the sidebar's own width while
      // it is open (see .tree-canvas in globals.css). Inset only — the canvas is
      // NOT resized, so the tree never re-fits or shifts under the user.
      className="tree-canvas"
      style={{
        width: '100%',
        height: '100%',
        opacity: isPositioned ? 1 : 0,
        transition: isPositioned ? 'opacity 0.15s ease' : 'none',
        // Export renders off-screen with no sidebar; keep the panels put there.
        ['--tree-panel-inset' as string]:
          sidebarSelectedId != null && !isExporting ? 'var(--tree-sidebar-w)' : '0px',
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={onInit}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.1}
        maxZoom={2}
        onlyRenderVisibleElements={!isExporting}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnScroll={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        {/* Background pattern */}
        <Background color={bgColor} gap={20} size={1} />

        {/* Zoom scale indicator — top-right corner */}
        <ZoomIndicator />

        {/* Zoom controls */}
        <Controls showInteractive={false} className="hidden md:block" />

        {/* Minimap for navigation — hidden on mobile via Tailwind, and hidden entirely
            on very large trees where it renders blank while still covering cards (#193 #3).
            The border + shadow + radius make it read as a deliberate floating overlay
            rather than clipped canvas content (the other half of #193 #3). */}
        {nodes.length <= MINIMAP_MAX_NODES && (
          <MiniMap
            // overflow-hidden: React Flow renders its own square <svg> inside, which
            // otherwise paints past the radius and shows a bleed at each corner.
            className="hidden md:block rounded-lg overflow-hidden border border-border shadow-lg"
            nodeColor={miniMapNodeColor}
            nodeStrokeWidth={3}
            zoomable
            pannable
          />
        )}

        {/* Dev-only debug overlay — toggle with D key */}
        {(process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEBUG_OVERLAY) && debugMode && <DebugOverlay />}
      </ReactFlow>
    </div>
  );
}

/**
 * TreeVisualization with ReactFlowProvider wrapper
 * Required for React Flow hooks to work properly
 */
export default function TreeVisualization(props: TreeVisualizationProps) {
  return (
    <ReactFlowProvider>
      <TreeVisualizationInner {...props} />
    </ReactFlowProvider>
  );
}
