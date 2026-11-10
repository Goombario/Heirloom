/**
 * Source-resolution math for the face crops on /library/faces.
 *
 * The crop is NOT a CROP_SIZE-pixel slice of the thumbnail. `FaceCropThumb`
 * stretches the WHOLE image into a CROP_SIZE box and then magnifies it by
 * `100 / RegionW`, so the browser samples the source at
 * `CROP_SIZE / (RegionW / 100)` CSS px across. A face 5% wide therefore needs a
 * ~1120px source to render sharp at 56px — not the 256px thumb this page
 * originally asked for, which gave it about 13 source pixels to fill 56.
 */
import { snapThumbSize, type ThumbSize } from '@/lib/media-url';

/** Rendered size of one face crop, in CSS px. */
export const CROP_SIZE = 56;

/**
 * Retina headroom. Face crops are small and dense, so a 1x source is visibly
 * soft on a 2x display; the snap list tops out at 1024 anyway, which bounds
 * what this can cost.
 */
const DPR_HEADROOM = 2;

/**
 * The thumbnail width to request for a face occupying `regionW` percent of the
 * image width. Always a server-whitelisted size (the file endpoint 400s on
 * anything else).
 *
 * Degenerate input (0, negative, NaN — a corrupt or unparsed region) takes the
 * LARGEST size rather than the smallest: the failure mode of guessing too small
 * is the unreadable blur this function exists to prevent, and these rows are
 * already dropped at parse time, so this branch should be unreachable.
 */
export function cropThumbWidth(regionW: number, renderedSize: number = CROP_SIZE): ThumbSize {
  if (!Number.isFinite(regionW) || regionW <= 0) return 1024;
  const fraction = Math.min(regionW, 100) / 100;
  return snapThumbSize((renderedSize * DPR_HEADROOM) / fraction);
}
