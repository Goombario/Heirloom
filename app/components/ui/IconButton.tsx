'use client';

import React from 'react';
import { cx } from './cx';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — applied to both `aria-label` and `title`. */
  label: string;
  /** The icon node (size it at the call site, e.g. `<X className="w-4 h-4" />`). */
  icon: React.ReactNode;
  /** 'square' → rounded-lg (default); 'round' → rounded-full. */
  shape?: 'square' | 'round';
  /** Padding preset. Use `className` for a fixed hit-area (e.g. `w-11 h-11`). */
  size?: 'sm' | 'md';
}

const SHAPE = { square: 'rounded-lg', round: 'rounded-full' } as const;
const SIZE = { sm: 'p-1', md: 'p-1.5' } as const;

/**
 * A muted icon button — the close-✕ (and general icon action) that was hand-rolled
 * with ~4 slightly-different className strings across the modals (#175 Wave 4).
 * Ships the full interaction-state set (hover surface + text, focus-visible ring,
 * disabled). The icon is passed in so callers keep control of its pixel size.
 */
export function IconButton({ label, icon, shape = 'square', size = 'md', className = '', type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex items-center justify-center shrink-0 cursor-pointer text-text-muted transition-colors',
        'hover:bg-[color:var(--color-hover-surface)] hover:text-text',
        'focus-ring',
        'disabled:opacity-50 disabled:pointer-events-none',
        SHAPE[shape],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
