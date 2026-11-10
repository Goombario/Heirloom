'use client';

import React, { useRef } from 'react';
import { cx } from './cx';

interface SegmentOption {
  v: string;
  l: string;
  /** Leading glyph, decorative (the label names the option). */
  icon?: React.ReactNode;
  /** Second line under the label (e.g. the tree rail's "↓ down"). */
  sub?: React.ReactNode;
  disabled?: boolean;
  /** Tooltip, e.g. why a disabled option is unavailable. */
  title?: string;
}

export interface SegmentedControlProps {
  value: string;
  options: SegmentOption[];
  onChange: (v: string) => void;
  'aria-label'?: string;
  /** Stretch to fill the container with equal-width segments. */
  fullWidth?: boolean;
  /**
   * Extra classes for the outer radiogroup — for a taller min-height floor
   * where a caller's own labels or narrow width mean a segment reliably
   * wraps to two lines. `align-items: stretch` (the flex default this control
   * relies on so every segment fills the row) measures each button's cross
   * size in a pass that runs BEFORE the button's final width forces the wrap,
   * so with only `.control-h`'s one-line floor the wrapped label's second
   * line gets clipped. Raising the floor high enough for the wrap (with `!`,
   * so it wins over `.control-h` regardless of which rule the build emits
   * later) sidesteps that: stretch then has a correctly-sized box to fill
   * buttons into instead of the under-measured one.
   */
  className?: string;
  /** Stack the segments (a list of choices in a narrow rail). */
  orientation?: 'horizontal' | 'vertical';
  /** Disable the whole control; the selected segment stays marked. */
  disabled?: boolean;
}

/**
 * Accessible radiogroup for mutually exclusive choices (Sex, Living status, case
 * status, …). Promoted from `person-form/SegmentedControl` into the design system
 * and de-literalized to Tailwind utilities (#175 Wave 5).
 *
 * Keyboard nav uses a ref array (no `document.*`): Arrow keys move (wrapping),
 * Space/Enter select, a single letter jumps to the first matching label, click
 * selects. Focus ring comes from the `.segment-option:focus-visible` rule (the #690 focus-ring token).
 * Disabled options are skipped by the arrows and the letter jump.
 *
 * Selected = the neutral ink fill a selected FilterChip uses (#691, decision 5):
 * `bg-text text-card`, ink on white in light and off-white on ink in dark, so the
 * choice reads at ≥14:1 instead of the old card-on-track 1.06:1 in dark. The track
 * is a hairline outline; unselected segments are muted with a hover wash. The fill
 * reads through `--color-segment-on` / `--color-on-segment` (text/card by default) because a dark
 * island remaps `--color-card` to a white wash, which would put near-white text on
 * a white fill there.
 */
export function SegmentedControl({ value, options, onChange, 'aria-label': ariaLabel, fullWidth = false, className, orientation = 'horizontal', disabled = false }: SegmentedControlProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeIdx = options.findIndex((o) => o.v === value);
  const tabFocusIdx = activeIdx >= 0 ? activeIdx : 0;

  const isEnabled = (o: SegmentOption) => !disabled && !o.disabled;

  function select(idx: number) {
    if (isEnabled(options[idx])) onChange(options[idx].v);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      select(idx);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      let next = idx;
      for (let n = 0; n < options.length; n++) {
        next = (next + step + options.length) % options.length;
        if (isEnabled(options[next])) break;
      }
      if (next === idx || !isEnabled(options[next])) return;
      onChange(options[next].v);
      buttonRefs.current[next]?.focus();
      return;
    }
    if (e.key.length === 1) {
      const key = e.key.toLowerCase();
      const next = options.findIndex((o) => isEnabled(o) && o.l.toLowerCase().startsWith(key));
      if (next >= 0) {
        e.preventDefault();
        onChange(options[next].v);
        buttonRefs.current[next]?.focus();
      }
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      aria-disabled={disabled || undefined}
      className={cx(
        orientation === 'vertical' ? 'flex flex-col' : fullWidth ? 'flex w-full' : 'inline-flex',
        orientation === 'horizontal' && 'control-h',
        'gap-0.5 border border-border rounded-md p-0.5',
        className,
      )}
    >
      {options.map((o, i) => {
        const active = o.v === value;
        return (
          <button
            key={o.v || '_blank'}
            ref={(el) => { buttonRefs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === tabFocusIdx ? 0 : -1}
            disabled={!isEnabled(o)}
            title={o.title}
            onClick={() => select(i)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={cx(
              // The buttons stretch to the --control-h container (flex default), so
              // the tap target is the whole control; the min-h floors survive as a
              // guard for any context where that height is overridden. pointer:coarse
              // keeps the 44px target — --control-h is 50px there, less 2px padding
              // and 1px border a side.
              'segment-option min-h-[30px] [@media(pointer:coarse)]:min-h-[44px] px-3 py-1 rounded border-0 text-meta cursor-pointer transition-colors',
              'disabled:cursor-not-allowed',
              orientation === 'vertical' ? 'text-left' : fullWidth && 'flex-1',
              active
                ? 'bg-segment-on text-on-segment font-semibold'
                : 'bg-transparent text-text-muted font-medium enabled:hover:bg-hover-surface enabled:hover:text-text disabled:opacity-40',
            )}
          >
            {o.icon || o.sub ? (
              <span className={cx('flex items-center gap-2', orientation === 'horizontal' && 'justify-center')}>
                {o.icon && <span aria-hidden="true" className="shrink-0">{o.icon}</span>}
                <span className="min-w-0">
                  <span className="block">{o.l}</span>
                  {o.sub && <span className={cx('block text-xs font-normal', active ? 'opacity-80' : 'text-text-muted')}>{o.sub}</span>}
                </span>
              </span>
            ) : o.l}
          </button>
        );
      })}
    </div>
  );
}
