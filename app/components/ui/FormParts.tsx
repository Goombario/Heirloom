'use client';

import { AlertTriangle, X } from '@/lib/icons';
import { IconButton } from './IconButton';
import { cx } from './cx';

/**
 * The parts of a v1.1 form dialog (#55). No cards: sections are an eyebrow and
 * space, facts sit side by side, and a linked person is a tinted block.
 */

/**
 * A form section: an eyebrow heading ("NAME", "BORN") with an optional action on
 * the right ("Cite ›"), then its fields. Sections are spaced, never boxed.
 */
export function FormBlock({ title, action, children, className }: {
  title: string;
  /** "Cite ›", "Add another name ›". An `ActionLink`. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('form-block grid gap-2.5 pt-5', className)} aria-label={title}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="eyebrow m-0">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Two facts side by side (Born | Died, Married | Ended), one column each. They
 * stack below 560px.
 */
export function FieldColumns({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('grid gap-x-6 gap-y-5 min-[560px]:grid-cols-2', className)}>{children}</div>;
}

/**
 * One column of `FieldColumns`. `inactive` greys the column and disables its
 * fields (Died while Living, Ended while Active), and `inactiveReason` takes the
 * action's place in the heading row, so both columns' fields stay level. The greyed
 * heading and reason stay muted text, so they still meet AA; the disabled fields
 * take the surface fill (`.field-column.is-inactive` in globals.css).
 */
export function FieldColumn({ title, action, inactive = false, inactiveReason, children }: {
  title: string;
  action?: React.ReactNode;
  inactive?: boolean;
  inactiveReason?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset disabled={inactive} className={cx('field-column m-0 grid min-w-0 content-start gap-2.5 border-0 p-0', inactive && 'is-inactive')}>
      <legend className="contents">
        <span className="flex items-baseline justify-between gap-3">
          <span className={cx('eyebrow', inactive && 'text-text-muted')}>{title}</span>
          {inactive ? inactiveReason && <span className="text-meta text-text-muted">{inactiveReason}</span> : action}
        </span>
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * A linked person or partner inside a form: a tinted block with the identity and a
 * × right after the name, then whatever belongs to that link (the relationship
 * select, the marriage date). Used for parents, partners and children.
 */
export function RecordBlock({ identity, onRemove, removeLabel, children, className }: {
  /** A `PersonIdentity`, `as="span"`. */
  identity: React.ReactNode;
  onRemove?: () => void;
  /** "Remove Johan Lindqvist". */
  removeLabel?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('record-block grid gap-3 rounded-card bg-surface-2 px-3.5 py-3', className)}>
      <div className="flex items-center gap-1 min-w-0">
        <div className="min-w-0">{identity}</div>
        {onRemove && removeLabel && (
          <IconButton label={removeLabel} onClick={onRemove} icon={<X className="w-4 h-4" aria-hidden="true" />} className="shrink-0" />
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * The one-line warning in a form ("These two already have a family", "Anna Berg
 * may already be in this tree"). Orange warning tokens, never amber (#55 C11):
 * amber is evidence. An optional action follows the text.
 */
export function WarningLine({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div role="status" className={cx('warning-line flex items-center gap-2 rounded-btn border-l-[3px] border-[color:var(--color-warning-edge)] bg-[color:var(--color-warning-bg)] px-3 py-2 text-sm text-[color:var(--color-warning-text)]', className)}>
      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}
