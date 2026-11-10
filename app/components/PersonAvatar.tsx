'use client';

import React from 'react';
import ProfileImage from '@/app/components/ProfileImage';
import { avatarClass } from '@/lib/utils/avatar';
import { StatusMark, type LivingStatus } from '@/app/components/ui/StatusMark';

/**
 * PersonAvatar — the photo-or-initials circle used in list rows, cards, and
 * pickers. When a primary photo exists it renders the focal-point-aware
 * `ProfileImage`; otherwise a gender-colored initials disc. Extracted so the
 * ~6 hand-rolled copies (People, Families, Places, SourceCard, …) stop
 * re-typing the `#fff`/fontSize/`avatar-*` fallback markup (design-system #175).
 *
 * The sex→disc-colour rule lives in the shared `avatarClass` helper (one source
 * for M/F/X/neutral) so every avatar surface agrees, including the non-binary
 * branch.
 *
 * `size` is a caller-provided dimension and the initials font-size is derived
 * from it, so both are legitimately inline (not tokenizable constants).
 */

export interface PersonAvatarProps {
  /** Primary media id; when set (and truthy) the focal photo is shown. */
  mediaId?: number | null;
  /** Accessible name for the photo + used only for `alt`. */
  name?: string;
  /** Pre-computed initials shown in the fallback disc. */
  initials?: string;
  /** Render this node centered instead of a photo/initials (e.g. a generic
   *  user icon on the audit chips). Wins over mediaId/initials. */
  icon?: React.ReactNode;
  /** Person Sex code — 'M'/'F'/'X' pick the gradient (via `avatarClass`);
   *  anything else falls back to neutral. */
  sex?: string | null;
  /** Diameter in px. */
  size: number;
  focalX?: number | null;
  focalY?: number | null;
  focalRadius?: number | null;
  /** Passed through to `ProfileImage` for multi-tree media resolution. */
  treeId?: number | null;
  /** Ring/border utility classes on the disc (e.g. `border-2 border-card`). */
  ringClassName?: string;
  /** Text/fill colour utility for the initials + icon. Defaults to `text-white`
   *  (the standard gradient discs). The places face-stacks sit on media and pass
   *  `text-[color:var(--color-on-media)]` instead. */
  textClassName?: string;
  /** Element for the wrapper + icon/initials disc — pass `span` when the avatar
   *  sits in a phrasing context (inside a `<button>` or `<span>`, e.g. the audit
   *  user chips or the picker result rows). Defaults to `div`. Note the photo
   *  branch still renders `ProfileImage` (its own `div`) inside this wrapper. */
  as?: 'div' | 'span';
  className?: string;
  /** Living-status mark on the avatar's corner (Teams-style), with a cutout ring
   *  in `--color-card`; set `--status-cutout` on an ancestor for other surfaces. */
  status?: LivingStatus;
  /** Accessible name for the corner mark. Omit when the status word is visible. */
  statusLabel?: string;
}

export default function PersonAvatar({
  mediaId,
  name = '',
  initials = '',
  icon,
  sex = null,
  size,
  focalX,
  focalY,
  focalRadius,
  treeId,
  ringClassName = '',
  textClassName = 'text-white',
  as = 'div',
  className = '',
  status,
  statusLabel,
}: PersonAvatarProps) {
  const genderClass = avatarClass(sex);
  // Polymorphic element so the disc can live in a phrasing context (a `span`
  // inside a button/inline is valid HTML; a `div` there is not). `display:flex`
  // via the utility classes still applies on a span.
  const Outer = as;
  const Inner = as;
  const outerDisplay = as === 'span' ? 'inline-flex ' : '';
  // Floor keeps initials legible on small discs (matches the prior
  // per-site factors: 18→8, 28→10, 32→11, 36→12).
  const initialsDisc = (
    <Inner
      className={`w-full h-full rounded-full flex items-center justify-center ${textClassName} font-semibold leading-none ${genderClass} ${ringClassName}`.trim()}
      style={{ fontSize: Math.max(8, Math.round(size * 0.34)) }}
    >
      {initials}
    </Inner>
  );
  const disc = (
    <Outer
      className={`${outerDisplay}relative rounded-full overflow-hidden shrink-0 ${status ? '' : className}`.trim()}
      style={{ width: size, height: size }}
    >
      {icon ? (
        <Inner className={`w-full h-full rounded-full flex items-center justify-center ${textClassName} ${genderClass} ${ringClassName}`.trim()}>
          {icon}
        </Inner>
      ) : mediaId ? (
        <>
          {/* Placeholder LAYER, not an alternative branch: `ProfileImage` paints
              nothing until its thumbnail has loaded AND decoded, so on a cold
              first load the disc used to sit empty — on a slow/cold thumbnail
              (#452) for seconds. The initials show through until the photo is
              promoted on top, so an avatar is never a blank hole. Absolute so it
              takes no space and the photo composites over it; `aria-hidden`
              because `ProfileImage`'s `alt` already names the person and the
              backdrop would otherwise read the initials out a second time. */}
          <Inner
            className="absolute inset-0 pointer-events-none"
            aria-hidden="true"
          >
            {initialsDisc}
          </Inner>
          <ProfileImage
            mediaId={mediaId}
            treeId={treeId ?? undefined}
            alt={name}
            focalX={focalX ?? 50}
            focalY={focalY ?? 50}
            focalRadius={focalRadius ?? null}
            containerWidth={size}
            containerHeight={size}
            circular
            // Ring lives on the disc element itself (border-box + rounded-full), so
            // the photo insets to a centered `size − 2·border` and the border is
            // circular — matching the prior markup. A ring on the outer wrapper
            // would clip an un-shrunk photo off-center; a non-rounded inner element
            // would render the border as a square inside the circular clip.
            // (It sets `position: relative` on itself, so it paints above the
            // absolutely-positioned placeholder without needing a z-index.)
            className={`rounded-full ${ringClassName}`.trim()}
          />
        </>
      ) : (
        initialsDisc
      )}
    </Outer>
  );
  if (!status) return disc;
  // The disc clips to its circle, so the corner mark sits in an unclipped wrapper.
  return (
    <Outer className={`${outerDisplay}relative shrink-0 ${className}`.trim()} style={{ width: size, height: size }}>
      {disc}
      <StatusMark status={status} size={size >= 56 ? 'lg' : 'md'} corner label={statusLabel} />
    </Outer>
  );
}
