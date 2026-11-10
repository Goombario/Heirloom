'use client';

import React from 'react';
import PersonAvatar from '@/app/components/PersonAvatar';
import { Avatar } from './Avatar';
import { cx } from './cx';

export interface AvatarStackPerson {
  id: number | string;
  name: string;
  sex?: string | null;
  src?: string | null;
  /** Primary photo id. Preferred over `src` in this app: media is addressed by
   *  id and resolved by `useMediaUrl` (http URL vs PGlite blob), which a plain
   *  `src` cannot express in the static build. */
  mediaId?: number | null;
}

export interface AvatarStackProps {
  people: AvatarStackPerson[];
  /** Disc diameter in px. */
  size?: number;
  /** Show at most this many discs; the remainder collapse into a "+N". */
  max?: number;
  /** Tree scope for `mediaId` resolution — required for photos to appear. */
  treeId?: number | null;
  className?: string;
}

/**
 * Overlapping cluster of person avatars — place cards, place detail, and the
 * "what this source proves" section for family citations.
 *
 * People with a profile photo sort first. That rule lives here rather than at
 * each call site so it holds consistently: a cluster whose visible discs are all
 * monogram initials reads as "we have no photos of these people", which is
 * usually false and only ever an artefact of arbitrary ordering.
 *
 * The separating ring and the "+N" disc assume a card-coloured host: the ring is
 * `--color-card` and the disc pairs `--surface-2` with `--text-secondary` (the
 * pairing `contrast-tokens.test.ts` asserts). On a surface that redefines those
 * tokens — a `--surface-2` panel, or anything inside `.hero-dark` — neither
 * holds, so a consumer tranche putting the stack there has to widen this rather
 * than assume it works.
 */
export function AvatarStack({ people, size = 32, max = 4, treeId = null, className = '' }: AvatarStackProps) {
  if (people.length === 0) return null;

  // Photos first, stable within each group (a plain sort in V8 is stable, so
  // callers keep whatever meaningful order they passed). "Has a photo" counts
  // either addressing mode.
  const hasPhoto = (p: AvatarStackPerson) => Boolean(p.src) || p.mediaId != null;
  const ordered = [...people].sort((a, b) => Number(hasPhoto(b)) - Number(hasPhoto(a)));
  const shown = ordered.slice(0, max);
  const overflow = ordered.length - shown.length;

  // Overlap by a third of the diameter — enough to read as a cluster, little
  // enough that each face stays identifiable.
  const overlap = Math.round(size / 3);

  return (
    <div
      role="group"
      aria-label={ordered.map((p) => p.name).join(', ')}
      className={cx('flex items-center', className)}
    >
      {shown.map((p, i) => (
        <div
          key={p.id}
          className="rounded-full ring-2 ring-card shrink-0"
          style={{ marginLeft: i === 0 ? 0 : -overlap, zIndex: shown.length - i }}
        >
          {p.mediaId != null ? (
            // PersonAvatar owns the mediaId → URL resolution (and the focal crop),
            // so a stack fed ids renders real photos in both build flavours.
            <PersonAvatar mediaId={p.mediaId} treeId={treeId} name={p.name} sex={p.sex ?? null} size={size} />
          ) : (
            <Avatar name={p.name} sex={p.sex ?? null} src={p.src ?? null} size={size} />
          )}
        </div>
      ))}
      {overflow > 0 && (
        <div
          className="flex items-center justify-center rounded-full ring-2 ring-card bg-surface-2 text-text-secondary font-semibold shrink-0"
          style={{
            marginLeft: -overlap,
            width: size,
            height: size,
            fontSize: Math.round(size * 0.34),
          }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
