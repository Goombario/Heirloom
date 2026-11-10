'use client';
import React from 'react';
import { cx } from './cx';

// Citation-chip styling (#331: replaces the retired unlayered `.cite` /
// `.cite.empty` / `.cite-square` classes). Shared with the app-level
// `app/components/Cite.tsx` wrapper so both chips can't drift.
// NB: `mono` (the layered DS class), NOT the Tailwind `font-mono` utility — in
// this app `font-mono` resolves to the empty `--font-mono` alias and falls back
// to Inter; `.mono` references `--font-jetbrains-mono` directly. The explicit
// `text-[10px]` overrides `.mono`'s 0.875em, matching the old `.cite` (10px).
// `cite-chip` is a hook for the phone person page's larger hit area (globals.css).
const CITE_BASE =
  'cite-chip inline-flex items-center justify-center h-[18px] rounded-[4px] mono text-xs ' +
  'font-semibold leading-none cursor-pointer align-super ml-px transition-[opacity,transform,box-shadow]';
// Evidence amber (#688): citation chips are the only clickable amber element.
// #692: a hairline edge plus a 1px key-cap shadow below mark it as pressable and
// set it apart from the flat, non-clickable evidence tag. Ring and shadow, not a
// border, so the 18px square keeps its size.
const CITE_FILLED =
  'bg-evidence-soft text-evidence ring-1 ring-inset ring-evidence-border ' +
  'shadow-[0_1px_0_var(--color-evidence-border)] hover:opacity-80 ' +
  // Pressed like a key: down 1px onto its own shadow (#753).
  'active:translate-y-px active:shadow-none';
const CITE_EMPTY =
  'bg-transparent text-text-muted border-[1.5px] border-dashed border-text-muted ' +
  'opacity-50 hover:opacity-100 hover:border-evidence hover:text-evidence';

/**
 * The citation chip's utility string. `square` keeps the chip a fixed 18×18
 * square (the app's deliberate deviation from the kit's variable-width chip —
 * see design-system.md); pass `square: false` for the kit's grow-wide variant.
 */
export function citeClass({ empty = false, square = true }: { empty?: boolean; square?: boolean } = {}): string {
  return cx(
    CITE_BASE,
    square ? 'min-w-[18px] w-[18px] p-0' : 'min-w-[18px] px-1',
    empty ? CITE_EMPTY : CITE_FILLED,
  );
}

export interface CiteProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'title'> {
  n?: number;
  empty?: boolean;
  title?: string;
}

export function Cite({ n, empty = false, title, className = '', onClick, onKeyDown, ...rest }: CiteProps) {
  const label = title ?? (empty ? 'Attach source' : 'View source');
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      className={cx(citeClass({ empty }), className)}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.currentTarget.click();
        }
        onKeyDown?.(e);
      }}
      {...rest}
    >
      {empty ? '+' : n}
    </span>
  );
}
