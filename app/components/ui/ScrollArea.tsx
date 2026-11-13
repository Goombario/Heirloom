'use client';

import React from 'react';
import { cx } from './cx';

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The scroll container itself (a dialog body measures or scrolls it). */
  ref?: React.Ref<HTMLDivElement>;
  /**
   * Keep the scrollbar rail painted even when the content fits (default). Turn it
   * off only where a container is almost never scrollable and the rail would read
   * as clutter — the content will then shift by the scrollbar's width the moment
   * it does overflow.
   */
  persistentRail?: boolean;
  /** Scroll axis. 'y' is the common case; 'both' for maps and wide tables. */
  axis?: 'y' | 'x' | 'both';
}

/**
 * Scroll container with a theme-aware scrollbar that stays visible.
 *
 * Exists because three separate surfaces hit the same defect: an unthemed OS
 * scrollbar that ignores the dark theme.
 *
 * On the reserved-space question: `scrollbar-gutter: stable` and `overflow: scroll`
 * both reserve the same column (measured 12px in Chromium), but only `scroll`
 * PAINTS a scrollbar in it when the content fits. With `stable`, the column is
 * empty, and a row's background stops short of the panel edge for no visible
 * reason — which is exactly how it was reported. A persistent rail keeps the
 * no-layout-shift property and makes the column legible as chrome. Dropping the
 * reservation instead would make the global-search list jump by 12px on every
 * keystroke that crosses the overflow threshold.
 *
 * Note there is no native overlay scrollbar to reach for here: `overflow: overlay`
 * is gone and `::-webkit-scrollbar` still takes layout width, so floating the
 * thumb over full-bleed content needs a JS component (Radix ScrollArea) — a
 * separate decision, not a CSS one.
 *
 * The visual styling lives in `.scroll-area` in globals.css — scrollbar
 * pseudo-elements cannot be expressed as Tailwind utilities.
 */
export function ScrollArea({
  persistentRail = true,
  axis = 'y',
  className = '',
  children,
  ...rest
}: ScrollAreaProps) {
  const overflow =
    axis === 'both'
      ? (persistentRail ? 'overflow-scroll' : 'overflow-auto')
      : axis === 'x'
        ? (persistentRail ? 'overflow-x-scroll overflow-y-hidden' : 'overflow-x-auto overflow-y-hidden')
        : (persistentRail ? 'overflow-y-scroll' : 'overflow-y-auto');

  return (
    <div className={cx('scroll-area', overflow, className)} {...rest}>
      {children}
    </div>
  );
}
