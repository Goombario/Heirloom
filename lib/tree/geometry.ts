/**
 * Single source of truth for tree-canvas geometry: card dimensions, spacing
 * between cards/generations, and the branch color palette.
 *
 * Everything that draws or measures tree cards must import from here —
 * PersonNode's rendered size, both layout paths, the fit-view math in
 * TreeVisualization, and the dev DebugOverlay. Before this module existed the
 * same numbers were declared independently in five files and had already
 * drifted (a stale "152px tall" comment survived a card resize to 145px).
 * #184 widened the card to 104 × 152 with a 72px photo, generations 228 apart.
 */

/** Rendered card footprint — must match PersonNode's inline width/height. */
export const PERSON_CARD_WIDTH = 104;
export const PERSON_CARD_HEIGHT = 152;

/** Extra height when the Display menu's "Second name" shows a second, smaller
 *  name line under the main one (vertical layout only). None keeps 152. */
const SECOND_NAME_LINE_HEIGHT = 16;

/** The portrait card's height, with or without the second name line. */
export function personCardHeight(secondName: boolean): number {
  return secondName ? PERSON_CARD_HEIGHT + SECOND_NAME_LINE_HEIGHT : PERSON_CARD_HEIGHT;
}

/** Compact horizontal-mode bar card footprint — must match PersonBarNode's
 *  inline width/height. 44px tall satisfies the ≥44px touch-target minimum. */
export const BAR_CARD_WIDTH = 188;
export const BAR_CARD_HEIGHT = 44;

/** Horizontal gap between a person card and each of their spouse cards. */
export const SPOUSE_GAP = 20;

/** Vertical distance between generations (d3 row height). */
export const VERTICAL_SPACING = 228;

/** Minimum horizontal gap between siblings (same parent). */
export const MIN_SIBLING_GAP = 60;

/** Minimum horizontal gap between nodes from different parents (cousins),
 *  also used by focus mode's Pass 3 side-tree overlap correction. */
export const MIN_BRANCH_GAP = 140;

/** Rotating per-branch edge colors. Avoids blue/pink, which would collide
 *  with the gender avatar colors. Ordered so no two adjacent branches share a
 *  hue family and orange is never next to a green — the orange/green pair is a
 *  worst case for red-green colour vision, so colour stays a usable secondary
 *  cue alongside the BranchEdge shape markers rather than the shapes carrying
 *  the whole load. */
export const BRANCH_COLORS = ['#34d399', '#a78bfa', '#fb923c', '#2dd4bf', '#fbbf24'];

// ── Focus mode canvas anchors ────────────────────────────────────────────────

/** Canvas Y of the focus person (rows above are negative). */
export const FOCUS_Y = 0;

/** Left edge of the horizontally-centered focus card. */
export const CENTER_X = -(PERSON_CARD_WIDTH / 2);

/** Gap enforced between the center card edge and each side tree (Stage A
 *  fallback anchors; Stage D anchors side trees at parent positions instead). */
export const INNER_GAP = 60;

// ── Injectable layout geometry ───────────────────────────────────────────────

/**
 * The footprint + spacing the one column engine lays out against. Injecting it
 * lets a second (bar) card size reuse the same d3 engine without forking it:
 * horizontal mode swaps in bar dimensions, everything else stays the same.
 *
 * The engine works in a spread-axis (sibling/spouse) × generation-axis frame.
 * `spreadExtent` is the card footprint along the spread axis; `generationSpacing`
 * is the d3 row height. Gaps are minimum separations along the spread axis.
 */
export interface LayoutGeometry {
  spreadExtent: number;
  generationSpacing: number;
  spouseGap: number;
  minSiblingGap: number;
  minBranchGap: number;
}

/** Default = today's portrait constants. Keeps existing layouts byte-identical. */
export const DEFAULT_LAYOUT_GEOMETRY: LayoutGeometry = {
  spreadExtent: PERSON_CARD_WIDTH,
  generationSpacing: VERTICAL_SPACING,
  spouseGap: SPOUSE_GAP,
  minSiblingGap: MIN_SIBLING_GAP,
  minBranchGap: MIN_BRANCH_GAP,
};

/* The second name line and the horizontal bars no longer have fixed geometries
   of their own: layoutGeometry() below builds them for the Spacing preset (#249). */

// ── Spacing presets (#249) ───────────────────────────────────────────────────

/** The Display menu's Spacing: Normal is today's gaps. */
export const TREE_SPACINGS = ['tight', 'normal', 'roomy'] as const;
export type TreeSpacing = typeof TREE_SPACINGS[number];

/** The gaps a preset sets: between generations (the empty space between rows,
 *  not the row pitch), brothers and sisters, cousins, and partners. */
interface SpacingGaps { generation: number; sibling: number; branch: number; spouse: number }

/**
 * Horizontal bars, as locked on #249 (generation pitch 224 / 260 / 300 less the
 * 188px bar). Vertical takes the same three steps scaled from its own constants
 * by the same ratio per gap, rounded.
 */
const SPACING_GAPS: Record<'vertical' | 'horizontal', Record<TreeSpacing, SpacingGaps>> = {
  horizontal: {
    tight: { generation: 224 - BAR_CARD_WIDTH, sibling: 20, branch: 52, spouse: 8 },
    normal: { generation: 260 - BAR_CARD_WIDTH, sibling: 34, branch: 84, spouse: 12 },
    roomy: { generation: 300 - BAR_CARD_WIDTH, sibling: 50, branch: 120, spouse: 18 },
  },
  vertical: {
    tight: { generation: 38, sibling: 35, branch: 87, spouse: 13 },
    normal: { generation: VERTICAL_SPACING - PERSON_CARD_HEIGHT, sibling: MIN_SIBLING_GAP, branch: MIN_BRANCH_GAP, spouse: SPOUSE_GAP },
    roomy: { generation: 118, sibling: 88, branch: 200, spouse: 30 },
  },
};

/**
 * The geometry a layout runs against: card footprint for the orientation (and the
 * second name line on portrait cards), gaps for the Spacing preset. Normal returns
 * exactly the fixed geometries above, so a tree at Normal doesn't move.
 */
export function layoutGeometry(opts: { horizontal: boolean; secondName?: boolean; spacing?: TreeSpacing }): LayoutGeometry {
  const spacing = opts.spacing ?? 'normal';
  if (opts.horizontal) {
    const g = SPACING_GAPS.horizontal[spacing];
    return { spreadExtent: BAR_CARD_HEIGHT, generationSpacing: BAR_CARD_WIDTH + g.generation, spouseGap: g.spouse, minSiblingGap: g.sibling, minBranchGap: g.branch };
  }
  const g = SPACING_GAPS.vertical[spacing];
  return {
    spreadExtent: PERSON_CARD_WIDTH,
    generationSpacing: personCardHeight(!!opts.secondName) + g.generation,
    spouseGap: g.spouse,
    minSiblingGap: g.sibling,
    minBranchGap: g.branch,
  };
}
