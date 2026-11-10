/**
 * Pure geometry for the tree's initial auto-fit. Extracted from
 * `TreeVisualization.fitViewWithAnchor` so the fit/anchor decision is unit-testable
 * (see #193 — a deep pedigree fit on a phone but clipped off-screen on desktop).
 */

export interface FitBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * The zoom the tree opens at when the whole tree won't fit at it: names on the
 * cards stay readable (FL-1, 2026-09-23 UX sweep). A tree that fits whole at or
 * above this zoom opens fitted; a bigger one opens at this zoom on the layout's
 * anchor (the root, or the focus person), and the minimap and the fit-to-view
 * control show the rest.
 *
 * ONE value for every viewport on purpose. `naturalFitZoom` already scales with the
 * available canvas (w, h), so a per-viewport value is wrong: the old split floor
 * (0.3 desktop / 0.2 mobile) gave the larger screen the higher bar, so the same tree
 * fit whole on a phone yet anchored on a desktop (#193).
 */
export const READABLE_ZOOM = 0.7;

/**
 * Zoom that fits the whole tree in a `w`×`h` canvas with `padding` (fraction of the
 * span added on each side), capped at `maxZoom`.
 */
export function naturalFitZoom(
  b: FitBounds,
  w: number,
  h: number,
  padding: number,
  maxZoom: number,
): number {
  const spanX = (b.maxX - b.minX) * (1 + 2 * padding);
  const spanY = (b.maxY - b.minY) * (1 + 2 * padding);
  // Guard degenerate (single-node) spans so we don't divide by zero.
  const zx = spanX > 0 ? w / spanX : maxZoom;
  const zy = spanY > 0 ? h / spanY : maxZoom;
  return Math.min(zx, zy, maxZoom);
}

/**
 * True when the whole tree fits at or above {@link READABLE_ZOOM} — i.e. the auto-fit
 * should center the full bounding box rather than switch to anchor mode.
 */
export function fitsWhole(
  b: FitBounds,
  w: number,
  h: number,
  padding: number,
  maxZoom: number,
): boolean {
  return naturalFitZoom(b, w, h, padding, maxZoom) >= READABLE_ZOOM;
}
