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
  /** The person was already reached elsewhere in this tree (pedigree collapse):
   *  a stub with no spouses or relatives, drawn as a faded repeat card (#13). */
  repeat?: true;
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
  /**
   * Names for the cards' optional second line (the Display menu's "Second name"),
   * keyed by person id. Only people with something to show are listed.
   */
  cardNames?: Record<number, TreeCardNames>;
  /** Facts for the cards' line under the name (#12), keyed by person id. Only
   *  people with at least one are listed. */
  cardFacts?: Record<number, TreeCardFacts>;
}

/** What the Display menu's "Under the name" puts on the card's line under the name (#12). */
export const TREE_UNDER_NAME = ['dates', 'occupation', 'residence', 'birthplace'] as const;
export type TreeUnderName = typeof TREE_UNDER_NAME[number];

/** One person's facts for the line under the name. Places are the town only. */
export interface TreeCardFacts {
  occupation?: string;
  /** Town of the latest residence event. */
  residence?: string;
  /** Town of the birth place. */
  birthplace?: string;
}

/** The name types the Display menu's "Second name" can show (NameVariant types). */
export const TREE_SECOND_NAME_TYPES = ['Nickname', 'Maiden', 'Married', 'Anglicized', 'Alias', 'Given'] as const;
export type TreeSecondNameType = typeof TREE_SECOND_NAME_TYPES[number];

/** One person's names for the card's second line. */
export interface TreeCardNames {
  /** "First Last" without the merged nickname; set only when the preferred name is a nickname. */
  original?: string;
  /** The name to show for each type: the preferred one first, else the first recorded. */
  byType: Partial<Record<TreeSecondNameType, string>>;
}

/**
 * Custom data attached to React Flow nodes
 */
export interface FlowNodeData {
  person: TreeNode | Spouse;
  isSpouse?: boolean;
  spouseIndex?: number;
  parentPersonId?: number;
  /** A later card for a person drawn in full elsewhere in this layout: the id of
   *  that full card. The repeat is faded, has an "Also in this tree" pill that
   *  pans there, and opens no editor of its own (#13). */
  repeatOf?: string;
  isSelected?: boolean; // True for the root/leaf person being viewed
  isSidebarSelected?: boolean; // True for the person clicked to open sidebar
  onPersonClick?: (id: number) => void;
  onPersonDoubleClick?: (id: number) => void;
  showAgeIndicator?: boolean;
  /** The living-status mark on the card (#68); hidden only when false. */
  showStatusMark?: boolean;
  /** The second name line is on (vertical cards): the card is taller, even when
   *  this person has no name of the chosen type. */
  secondNameOn?: boolean;
  /** The name for the card's second line, or null for an empty line. */
  secondName?: string | null;
  /** Replaces the main line (the original name when Nickname is the second name). */
  mainName?: string;
  /** The Display menu's "Under the name" (#12): set when it isn't dates. The card
   *  shows `underText` there in the normal font, or a blank line when it's null. */
  underName?: Exclude<TreeUnderName, 'dates'>;
  underText?: string | null;
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
  /** Parent lines: the drop leaves the parent here (the bracket's axis) instead
   *  of the card's middle, onto a child just off it (#15). */
  snapTo?: number;
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
