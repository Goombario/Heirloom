'use client';

import { cropThumbWidth } from '@/lib/media/face-crop';
import MediaImg from '@/app/components/MediaImg';
import { cx } from '@/app/components/ui/cx';
import type { MediaFaceCandidate } from '@/lib/db/schema';

/**
 * A single face, cropped from the media thumbnail via a CSS transform (the
 * region-box math PhotoStage uses for its overlay boxes, applied here as a
 * scale+translate instead of an absolutely-positioned box) — so it works
 * through `MediaImg`/`getDataClient()` in both the hosted and local builds,
 * unlike a raw `background-image` URL.
 *
 * With `onClick` it is a button (the queue opens the face's photo); without, a
 * labelled image.
 */
export function FaceCropThumb({
  candidate, treeId, size, label, onClick, className,
}: {
  candidate: MediaFaceCandidate;
  treeId: number | null;
  size: number;
  label: string;
  onClick?: () => void;
  className?: string;
}) {
  const sx = 100 / Math.max(candidate.RegionW, 1);
  const sy = 100 / Math.max(candidate.RegionH, 1);
  const classes = cx('relative block shrink-0 overflow-hidden rounded-[9px] bg-card-alt focus-ring', className);
  const style = { width: size, height: size };
  const image = (
    <MediaImg
      mediaId={candidate.MediaId}
      treeId={treeId}
      alt=""
      // Sized from THIS face's region, not a fixed thumb: the transform below
      // magnifies by 100/RegionW, so a 5%-wide face sampled from a 256px thumb
      // had ~13 source pixels to fill 56 CSS px (#487 PR boundary — reported as
      // "faces basically unrecognizable"). See lib/media/face-crop.ts.
      width={cropThumbWidth(candidate.RegionW, size)}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        // NOT objectFit:'cover' (#487 review) — thumbnails preserve aspect ratio
        // (`fit: 'inside'`, lib/media-thumbnail.ts / lib/services/media-upload.ts),
        // so `cover` pre-crops a non-square thumb to a centred square BEFORE the
        // scale/translate below runs, breaking the element-fraction <-> image-fraction
        // identity that transform assumes. `fill` stretches the whole image into the
        // box (mild distortion, same trade-off WhoIsThisModal's background-size makes)
        // so the region math stays exact.
        objectFit: 'fill',
        transformOrigin: '0 0',
        transform: `scale(${sx}, ${sy}) translate(${-candidate.RegionX}%, ${-candidate.RegionY}%)`,
      }}
    />
  );

  if (!onClick) {
    return <span role="img" aria-label={label} title={label} className={classes} style={style}>{image}</span>;
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cx(classes, 'cursor-pointer')} style={style}>
      {image}
    </button>
  );
}

/**
 * The whole photo with this face boxed (#1156): the desktop face peek and the
 * phone face sheet. The box sits in the image's own box, so its percentages are the
 * stored region's.
 */
export function FacePhotoWithBox({ candidate, treeId, width }: { candidate: MediaFaceCandidate; treeId: number | null; width: number }) {
  return (
    <span className="relative block overflow-hidden rounded-lg bg-card-alt">
      <MediaImg mediaId={candidate.MediaId} treeId={treeId} width={width} alt={candidate.MediaTitle ?? ''} className="block h-auto w-full" />
      <span
        aria-hidden="true"
        className="absolute rounded-[3px] border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
        style={{
          left: `${candidate.RegionX}%`,
          top: `${candidate.RegionY}%`,
          width: `${candidate.RegionW}%`,
          height: `${candidate.RegionH}%`,
        }}
      />
    </span>
  );
}
