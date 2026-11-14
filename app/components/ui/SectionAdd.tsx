'use client';

import { forwardRef } from 'react';
import { Plus } from '@/lib/icons';
import { cx } from './cx';

/**
 * A section's "Add …" at the right end of its heading (#157): the v1.1 desktop person
 * and family pages put each section's Add on the `SectionHeader` line instead of a
 * trailing row under the content. Ink link text with a plus; the hit area reaches
 * past the text so the target is at least 32px tall without moving the heading.
 */
export const SectionAdd = forwardRef<HTMLButtonElement, Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
}>(function SectionAdd({ label, className, ...rest }, ref) {
  return (
    <button ref={ref} type="button" {...rest} className={cx('section-add focus-ring', className)}>
      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </button>
  );
});

/**
 * A section with nothing in it, as one line (#157): its label, a muted value ("None
 * yet", or the one name on record) and its Add on the right. The page marks the
 * section element `is-empty`, so consecutive empty lines group under one hairline.
 * The section switches back to its normal layout as soon as it has an item.
 */
export function SectionEmpty({ title, headingId, children, action }: {
  title: React.ReactNode;
  headingId?: string;
  /** The muted value. */
  children: React.ReactNode;
  /** The section's Add (a `SectionAdd`), when the role can add. */
  action?: React.ReactNode;
}) {
  return (
    <div className="section-empty">
      <h2 id={headingId} className="eyebrow m-0 section-empty__label">{title}</h2>
      <span className="section-empty__what">{children}</span>
      {action}
    </div>
  );
}
