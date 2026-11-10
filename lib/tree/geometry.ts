/**
 * Single source of truth for tree-canvas geometry: card dimensions, spacing
 * between cards/generations, and the branch color palette.
 *
 * Everything that draws or measures tree cards must import from here —
 * PersonNode's rendered size, both layout paths, the fit-view math in
 * TreeVisualization, and the dev DebugOverlay. Before this module existed the
 * same numbers were declared independently in five files and had already
 * drifted (a stale "152px tall" comment survived a card resize to 145px).
 */

/** Rendered card footprint — must match PersonNode's inline width/height. */
export const PERSON_CARD_WIDTH = 96;
export const PERSON_CARD_HEIGHT = 145;

/** Compact horizontal-mode bar card footprint — must match PersonBarNode's
 *  inline width/height. 44px tall satisfies the ≥44px touch-target minimum. */
export const BAR_CARD_WIDTH = 188;
export const BAR_CARD_HEIGHT = 44;

/** Horizontal gap between a person card and each of their spouse cards. */
export const SPOUSE_GAP = 20;

/** Vertical distance between generations (d3 row height). */
export const VERTICAL_SPACING = 220;

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

/**
 * Horizontal bars: the spread axis (which becomes vertical after the transpose)
 * carries the bar HEIGHT, and generations are spaced for the bar WIDTH. Gaps are
 * smaller than portrait mode because bars are short along the spread axis.
 * Values are an initial pass — tune visually.
 */
export const HORIZONTAL_BAR_GEOMETRY: LayoutGeometry = {
  spreadExtent: BAR_CARD_HEIGHT,
  generationSpacing: BAR_CARD_WIDTH + 72, // ≈260
  spouseGap: 12,
  minSiblingGap: 34,
  minBranchGap: 84,
};
