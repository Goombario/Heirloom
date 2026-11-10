'use client';
import React, { forwardRef } from 'react';
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
