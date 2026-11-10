interface Box { top: number; bottom: number; left: number; right: number }

const GAP = 8;
const MARGIN = 12;
const MAX_WIDTH = 480;

/**
 * Where the citation popover sits (EV-5): below the fact's row, or above it
 * when there's no room below, so it never covers the row it describes; and
 * horizontally within the content column (`bounds`), centred on the chip where
 * it fits. When it fits neither side it takes the roomier one and caps its
 * height there, scrolling inside, rather than covering the row.
 */
export function placeCitationPopover({ anchor, row, bounds, height, viewport }: {
  anchor: Box;
  row: Box;
  bounds: Box;
  height: number;
  viewport: { width: number; height: number };
}): { top: number; left: number; width: number; maxHeight: number } {
  const minLeft = Math.max(MARGIN, bounds.left);
  const maxRight = Math.min(viewport.width - MARGIN, bounds.right);
  const width = Math.max(0, Math.min(MAX_WIDTH, maxRight - minLeft));
  const centred = (anchor.left + anchor.right) / 2 - width / 2;
  const left = Math.max(minLeft, Math.min(centred, maxRight - width));

  const below = row.bottom + GAP;
  const roomBelow = viewport.height - MARGIN - below;
  const roomAbove = row.top - GAP - MARGIN;
  if (height <= roomBelow) return { top: below, left, width, maxHeight: roomBelow };
  if (height <= roomAbove) return { top: row.top - GAP - height, left, width, maxHeight: roomAbove };
  return roomBelow >= roomAbove
    ? { top: below, left, width, maxHeight: roomBelow }
    : { top: MARGIN, left, width, maxHeight: roomAbove };
}
