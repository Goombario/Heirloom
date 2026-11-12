'use client';

import { forwardRef } from 'react';
import { Plus } from '@/lib/icons';
import { cx } from './cx';

/**
 * The trailing "Add …" row that ends a collection (#760, design-system.md §Editing
 * patterns). It opens the collection's inline panel (`.inline-panel`) in its place.
 * Inside a card, pass `className="border-t border-border-light"` so it reads as the
 * list's last row.
 */
export const AddRow = forwardRef<HTMLButtonElement, Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
}>(function AddRow({ label, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cx(
        'flex w-full min-h-10 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-4 py-2.5 text-left text-meta font-medium text-link',
        'transition-colors hover:bg-hover-surface focus-ring-inset disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
    >
      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </button>
  );
});

/**
 * An empty slot (#55): a dashed plus disc, a title and a hint, as in the forms'
 * "Add a partner" and the family page's "Partner unknown · Find or add someone".
 * One click opens the slot's finder.
 */
export const EmptySlot = forwardRef<HTMLButtonElement, Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> & {
  title: string;
  hint?: string;
}>(function EmptySlot({ title, hint, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cx(
        'empty-slot flex w-full cursor-pointer items-center gap-3 rounded-card border border-dashed bg-transparent px-3 py-2.5 text-left',
        'transition-colors hover:bg-hover-surface focus-ring disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
    >
      <span aria-hidden="true" className="empty-slot__disc grid place-items-center w-[34px] h-[34px] shrink-0 rounded-full border border-dashed">
        <Plus className="w-4 h-4" />
      </span>
      <span className="grid min-w-0">
        <span className="text-sm font-semibold text-text">{title}</span>
        {hint && <span className="text-meta text-text-muted">{hint}</span>}
      </span>
    </button>
  );
});

/**
 * A suggestion that acts in one click (the row rule, #55): a plus, who it is, and a
 * one-line reason ("Same last name; born 7 years after the marriage"). Used in the
 * forms, the family page's Add child and the finders. Pass `identity` as a
 * `PersonIdentity` with `as="span"`, since it sits inside the button.
 */
export const SuggestionRow = forwardRef<HTMLButtonElement, Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  identity: React.ReactNode;
  reason?: string;
}>(function SuggestionRow({ identity, reason, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cx(
        'flex w-full cursor-pointer items-center gap-3 rounded-btn border-0 bg-transparent px-2 py-1.5 text-left text-text',
        'transition-colors hover:bg-hover-surface focus-ring-inset disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
    >
      <span aria-hidden="true" className="grid place-items-center w-6 h-6 shrink-0 rounded-full border border-border text-link">
        <Plus className="w-3.5 h-3.5" />
      </span>
      <span className="grid min-w-0 flex-1">
        {identity}
        {reason && <span className="text-meta text-text-muted mt-0.5 pl-[46px]">{reason}</span>}
      </span>
    </button>
  );
});
