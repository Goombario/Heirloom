// TypeScript interfaces for Tree2 visualization

import { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow';

/**
 * Tree node structure from API endpoint
 * Represents a person and their relationships in the family tree
 */
/**
 * A card's life span as display years, formatted server-side ("~1876" keeps its
 * "~"), for `<Lifespan preformatted>` (#808, DV-1). `deceased` without a death
 * year reads "1895–?". A living person's card reads "b. 1954": "1954–living"
 * doesn't fit the card's date strip.
 */
export interface TreeLifespan {
  birth: string | null;
  death: string | null;
  deceased: boolean;
}

export interface TreeNode {
  id: number;
  name: string;
  photoMediaId: number | null;
  focalX?: number;
  focalY?: number;
  focalRadius?: number | null;
  sex?: string | null;
  lifespan?: TreeLifespan;
  age?: number | string; // computed server-side; string (e.g. "6mo") for infants, number for older
  /** Birth year (parsed) — used to sort siblings/children left-to-right by birth order */
  birthYear?: number;
  spouses: Spouse[];
  isDeceased?: boolean | null;
  otherParentId?: number;
  children?: TreeNode[];
  /** Populated only for the root in ancestor mode — siblings to display at the same generation */
  siblings?: SiblingInfo[];
}

/**
 * Sibling information attached to the root person in ancestor mode
 */
interface SiblingInfo {
  id: number;
  name: string;
  photoMediaId: number | null;
  focalX?: number;
  focalY?: number;
  focalRadius?: number | null;
  sex?: string | null;
  lifespan?: TreeLifespan;
  age?: number | string;
  /** Birth year (parsed) — used to sort siblings left-to-right by birth order */
  birthYear?: number;
  isDeceased?: boolean | null;
  /** ID of the parent node (already in the tree) to draw the edge from */
  connectingParentId: number;
}

/**
 * Spouse information attached to a person
 */
export interface Spouse {
  id: number;
  name: string;
  photoMediaId: number | null;
  focalX?: number;
  focalY?: number;
  focalRadius?: number | null;
  sex?: string | null;
  lifespan?: TreeLifespan;
  age?: number | string; // computed server-side; string (e.g. "6mo") for infants, number for older
  /** Birth year (parsed) — used to sort multiple spouses left-to-right by birth order */
  birthYear?: number;
  isDeceased?: boolean | null;
  hasChildren: boolean;
}

/**
 * Tagged union for Focus view mode. Stage A is fallback (focus has no parents),
 * Stage D is the canonical case (focus has at least one parent).
 */
export type FocusTrees =
  | {
      /** No parents → CENTER rooted at the focus person; no left/right ancestor chains. */
      stage: 'A';
      center: TreeNode;
      focusPersonId: number;
    }
  | {
      /** At least one parent → CENTER rooted at the father (or mother if no father). */
      stage: 'D';
      /** Paternal ancestor chain terminating at the father (leaf, deduped into CENTER). */
      left: TreeNode | null;
      /** Maternal ancestor chain terminating at the mother (leaf, deduped into CENTER). */
      right: TreeNode | null;
      center: TreeNode;
      focusPersonId: number;
      /** ID of the focus person's immediate father (left-tree side); null when only the mother exists. */
      leftParentId: number | null;
      /** ID of the focus person's immediate mother (right-tree side); null when only the father exists. */
      rightParentId: number | null;
    };

/**
 * Full tree data returned from API
 */
export interface TreeData {
  tree: TreeNode;
  roots: { id: number; name: string }[];
  currentRootId: number;
  currentMode: 'descendants' | 'ancestors' | 'focus';
  suggestedMode: 'descendants' | 'ancestors' | 'focus';
  parents: { id: number; name: string }[];
  allPeople: {
    id: number;
    name: string;
    /** Space-joined name-variant names, for searching across all of a person's names. */
    allNames?: string | null;
    isRoot: boolean;
    isLeaf: boolean;
    hasAncestors: boolean;
    hasDescendants: boolean;
    isIsolated: boolean;
  }[];
  focusTrees?: FocusTrees;
}

/**
 * Custom data attached to React Flow nodes
 */
export interface FlowNodeData {
  person: TreeNode | Spouse;
  isSpouse?: boolean;
  spouseIndex?: number;
  parentPersonId?: number;
  isSelected?: boolean; // True for the root/leaf person being viewed
  isSidebarSelected?: boolean; // True for the person clicked to open sidebar
  onPersonClick?: (id: number) => void;
  onPersonDoubleClick?: (id: number) => void;
  showAgeIndicator?: boolean;
  /** The living-status mark on the card (#68); hidden only when false. */
  showStatusMark?: boolean;
  /** DEBUG (horizontal bar review): zoom level below which the bar switches to
   *  zoomed-out mode (name-only, scaled). Default 0.6. */
  barZoomThreshold?: number;
}

/**
 * React Flow node with our custom data
 */
export type FlowNode = ReactFlowNode<FlowNodeData>;

/**
 * Custom data for branch edges (parent-child connections where parent has multiple spouses)
 * and spouse connector edges (horizontal links between a person and their spouses).
 */
export interface BranchEdgeData {
  shapeIndex?: number;
  colorblindMode?: boolean;
  spouseIndex?: number;   // which spouse this connector leads to (0-based)
  totalSpouses?: number;  // total number of spouses on the source node
  /** Spouse-connector lane axis: 'x' = horizontal lanes (vertical layout,
   *  default), 'y' = vertical lanes (horizontal layout, spouses stacked). */
  laneAxis?: 'x' | 'y';
}

/**
 * React Flow edge (connections between nodes)
 */
export type FlowEdge = ReactFlowEdge<BranchEdgeData>;

/**
 * Result from a single column-engine pass (nodes + edges only)
 */
export interface LayoutResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Bounding box of a finished layout in canvas px (card extents included).
 */
export interface LayoutBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Viewport anchor declared by the layout: which node the initial fit should
 * center on horizontally, and where it belongs vertically. The renderer must
 * not re-derive this per mode — each layout knows its own anchor.
 * (Not exported: consumers receive it via LayoutOutput['anchor'].)
 */
interface LayoutAnchor {
  nodeId: string;
  placement: 'top' | 'bottom' | 'center' | 'left';
}

/**
 * Full output of a mode layout (standard / focus): positioned nodes + edges
 * plus the geometry the renderer needs for viewport fitting. `bounds` and
 * `anchor` are null only for empty layouts.
 */
export interface LayoutOutput extends LayoutResult {
  bounds: LayoutBounds | null;
  anchor: LayoutAnchor | null;
}
