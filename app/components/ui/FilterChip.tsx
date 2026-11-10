'use client';
import React from 'react';

interface FilterChipBaseProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  active?: boolean;
  count?: number | null;
  /** Chip content. Use either `label` or `children` (label wins if both given). */
  label?: React.ReactNode;
  /** Show a skeleton in the count slot (reserves space, no value pop). */
  loading?: boolean;
  /** Leading icon, such as `Plus` on an "Add …" chip. Never type a "+" into the label. */
  icon?: React.ReactNode;
}

/** A dismissible chip MUST supply both halves of its ✕ — a handler that clears
 *  (not toggles) the filter, and a translated accessible name. Enforced here so
 *  a caller cannot ship a ✕ that is nameless or does nothing. */
type FilterChipDismissProps =
  | { dismissible: true; onDismiss: () => void; dismissLabel: string }
  | { dismissible?: false; onDismiss?: never; dismissLabel?: never };

export type FilterChipProps = FilterChipBaseProps & FilterChipDismissProps;

// Fully-rounded pill filter chip (Families / People / Cases / Library). A toggle
// with an optional count badge — deliberately its own primitive (not Button or
// Badge). Styled with Tailwind utilities (the old .filter-chip CSS class is retired).
const COUNT = 'text-xs tabular-nums';
// Count colour on an ACTIVE chip. The active chip inverts to `bg-text text-card`,
// so this is --color-card composited over --color-text at this alpha. It must clear
// WCAG AA (4.5:1 — 12px text) in BOTH themes, and dark is the tight side: the chip
// background is the near-white --color-text (#FAFAF9) and the count is the dark
// --color-card (#292524), so a low alpha washes toward mid-grey. At the previous
// 55% that composited to #878584 = 3.51:1 — a real AA failure. 70% gives 9.02:1
// light / 5.53:1 dark while staying visibly de-emphasised against the chip label.
// Guarded by the composited case in __tests__/unit/contrast-tokens.test.ts.
const COUNT_ACTIVE = 'text-card/70';

// The pill's own box — shared by the plain chip and by the wrapper used when a
// dismiss control is present, so both render identically. One fixed height (28px,
// border included) on every page, whatever the label holds: padding-driven heights
// drifted 25–29px with an icon or a typed glyph in the label (CT-2). A touch sheet
// may raise it with `min-h-*`.
const SHELL = 'inline-flex items-center shrink-0 h-7 rounded-full border-[1.5px] transition-colors';
const TEXT = 'text-sm font-medium leading-none whitespace-nowrap cursor-pointer';
const FOCUS = 'focus-ring';
const tone = (active: boolean) =>
  active ? 'bg-text text-card border-text' : 'bg-card text-text-2 border-border hover:bg-surface-2';

export function FilterChip({ active = false, count = null, label, loading = false, icon, dismissible = false, onDismiss, dismissLabel, className = '', children, ...rest }: FilterChipProps) {
  const bodyRef = React.useRef<HTMLButtonElement>(null);
  const countSlot = loading ? (
    <span className={`${COUNT} ${active ? COUNT_ACTIVE : 'text-text-muted'}`}>
      <span className="skeleton inline-block w-3 h-[11px] rounded-[3px] align-middle" aria-hidden="true" />
    </span>
  ) : count != null ? (
    <span className={`${COUNT} ${active ? COUNT_ACTIVE : 'text-text-muted'}`}>{count}</span>
  ) : null;

  // A <button> may not contain another <button>, so a dismissible chip is a
  // wrapper holding two sibling buttons. The ✕ used to be a <span> inside the
  // chip's own button, which meant clicking it fired the chip's onClick and
  // toggled/cycled the filter instead of clearing it.
  //
  // The wrapper is rendered for every dismissible chip, active or not. Switching
  // the ROOT element between <button> and <span> as `active` flips would make
  // React remount the whole chip, dropping keyboard focus on every press — so a
  // keyboard user could not cycle a tri-state chip without tabbing back to it.
  if (dismissible) {
    return (
      <span className={`${SHELL} ${tone(active)} ${className}`.trim()}>
        <button
          type="button"
          ref={bodyRef}
          aria-pressed={active}
          className={`inline-flex items-center self-stretch gap-1.5 pl-3.5 ${active ? 'pr-1.5' : 'pr-3.5'} ${active ? 'rounded-l-full' : 'rounded-full'} ${TEXT} ${FOCUS}`}
          {...rest}
        >
          {icon}
          {label ?? children}
          {countSlot}
        </button>
        {active && (
          <button
            type="button"
            // The ✕ unmounts as it clears, so hand focus back to the chip body
            // rather than letting it fall to <body>.
            onClick={() => { onDismiss?.(); bodyRef.current?.focus(); }}
            aria-label={dismissLabel}
            title={dismissLabel}
            // ≥24×24 (WCAG 2.5.8) at the pill's own height. A pseudo-element hit-area
            // expansion was tried and removed: on mobile the chip row is an
            // overflow-x scroller, which clips it back to the row's height — so it
            // only grew the target on desktop, where it is least needed.
            className={`inline-flex items-center justify-center self-stretch min-w-[24px] pl-0.5 pr-3 rounded-r-full opacity-70 hover:opacity-100 ${TEXT} ${FOCUS}`}
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      className={`${SHELL} gap-1.5 px-3.5 ${TEXT} ${FOCUS} ${tone(active)} ${className}`.trim()}
      {...rest}
    >
      {icon}
      {label ?? children}
      {countSlot}
    </button>
  );
}
