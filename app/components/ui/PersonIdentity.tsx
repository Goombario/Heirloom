'use client';

import PersonAvatar from '@/app/components/PersonAvatar';
import { cx } from './cx';

interface PersonIdentityProps {
  /** Already-resolved display name; callers handle their own "(Unknown)" fallback. */
  name: string;
  initials?: string;
  /** A compact `<Lifespan />` (it carries its own muted mono, #935), or null. */
  lifespan?: React.ReactNode;
  /** Supplementary meta shown before the lifespan (e.g. the picker's sex label). */
  meta?: string | null;
  /** Shown after the lifespan: what tells same-named people apart, such as
   *  "child of X & Y" (#793). */
  detail?: string | null;
  mediaId?: number | null;
  sex?: string | null;
  focalX?: number | null;
  focalY?: number | null;
  focalRadius?: number | null;
  treeId?: number | null;
  size?: 'sm' | 'md';
  /**
   * The relationship tag after the lifespan ("foster child", "half-sibling",
   * "stepson"), muted text, not a badge (#55).
   */
  role?: string | null;
  /**
   * `serif` for a name that titles its row: rail rows and table name cells on the
   * v1.1 desktop pages (C9 on #55). Pickers, finders and chips stay `sans`.
   */
  nameStyle?: 'sans' | 'serif';
  /**
   * Pass `span` whenever this sits in a phrasing context — inside a `<button>`
   * or `<span>`. EVERY wrapper follows it, not just the avatar: a `<div>` inside
   * a `<button>` is invalid HTML and React will not warn about it.
   */
  as?: 'div' | 'span';
  className?: string;
}

const AVATAR_PX: Record<'sm' | 'md', number> = { sm: 24, md: 34 };

/**
 * The photo-or-initials disc beside a name and a mono lifespan — the row
 * used by the person picker, and by the faces queue's ambiguity chips.
 *
 * Name typography (TYPE-5, #687): a person's name is serif only when it is a
 * card's title. In tables, dense lists, pickers and chips — everywhere this
 * primitive is used — it is sans, with the row sub-line at the 12px meta size.
 *
 * Identity only: it is deliberately NOT interactive and owns no click handler,
 * so callers decide whether it is a button, a link, or static text.
 *
 * Extracted from `PersonPicker`'s private `ResultRow` (#487 follow-up). Roughly
 * a dozen other screens still hand-roll this pattern; migrating them is tracked
 * separately rather than widened into this change.
 */
export function PersonIdentity({
  name,
  initials = '',
  lifespan = null,
  meta = null,
  detail = null,
  mediaId,
  sex = null,
  focalX,
  focalY,
  focalRadius,
  treeId,
  size = 'md',
  role = null,
  nameStyle = 'sans',
  as = 'div',
  className = '',
}: PersonIdentityProps) {
  const Box = as;
  const box = as === 'span' ? 'inline-flex' : 'flex';
  const stack = as === 'span' ? 'block' : '';

  return (
    <Box className={cx(box, 'items-center gap-3 min-w-0', className)}>
      <PersonAvatar
        as={as}
        mediaId={mediaId}
        treeId={treeId}
        name={name}
        initials={initials}
        sex={sex}
        size={AVATAR_PX[size]}
        focalX={focalX}
        focalY={focalY}
        focalRadius={focalRadius}
      />
      <Box className={cx(stack, 'min-w-0')}>
        <Box className={cx(stack, 'font-semibold leading-tight text-text truncate', nameStyle === 'serif' ? 'serif text-md' : 'text-base')}>
          {name}
        </Box>
        {(meta || lifespan || detail || role) && (
          <Box className={cx(stack, 'text-meta truncate')}>
            {meta && <span className="text-text-secondary">{meta}</span>}
            {meta && lifespan && <span className="text-border"> · </span>}
            {lifespan}
            {(meta || lifespan) && detail && <span className="text-border"> · </span>}
            {detail && <span className="text-text-secondary">{detail}</span>}
            {(meta || lifespan || detail) && role && <span className="text-border"> · </span>}
            {role && <span className="text-text-muted">{role}</span>}
          </Box>
        )}
      </Box>
    </Box>
  );
}
