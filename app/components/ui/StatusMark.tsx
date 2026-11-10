import { cx } from './cx';

import type { LivingStatus } from '@/lib/living';

export type { LivingStatus };

interface StatusMarkProps {
  status: LivingStatus;
  /** sm beside the word, md on list avatars, lg on avatars of 56px+, tree a fixed
   *  14px on tree cards whatever the symbols option (#736; see globals.css). */
  size?: 'sm' | 'md' | 'lg' | 'tree';
  /** Position on an avatar's bottom-right corner, with a cutout ring. The parent
   *  must be `relative`; set `--status-cutout` on it when the surface behind the
   *  avatar is not `--color-card`. */
  corner?: boolean;
  /** Accessible name ("Living"). Omit when a visible word sits beside the mark,
   *  so screen readers don't hear it twice. */
  label?: string;
  className?: string;
}

// Genealogical notation (DIN 5008, ÖNORM A 1080, FamilySearch): † died. Living is a
// plain filled dot; the asterisk (born) read badly at this size. The symbols only
// show with the Accessibility option on (html[data-status-symbols="on"], see
// globals.css); by default every state is a small plain dot beside its word.
const QUESTION = (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d="M5.3 5.4a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.6-.8 1.1v.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="7" cy="10.3" r=".85" fill="currentColor" />
  </svg>
);

/**
 * A person's living status as a small dot: filled green for living, grey for
 * deceased, a hollow ring for unknown. With the Accessibility option on it grows and
 * carries `†` (deceased) or `?` (unknown). The dot is decorative; meaning comes from
 * `label` or from the word shown beside it.
 */
export function StatusMark({ status, size = 'sm', corner = false, label, className = '' }: StatusMarkProps) {
  const glyph = status === 'living' ? null
    : status === 'deceased' ? <span className="status-dagger" aria-hidden="true">{'†'}</span>
    : QUESTION;
  return (
    <span
      className={cx('status-mark', corner && 'status-corner', className)}
      data-status={status}
      data-size={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {glyph}
    </span>
  );
}
