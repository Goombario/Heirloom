'use client';
import React from 'react';
import { cx } from './cx';

type Variant = 'primary' | 'tonal' | 'outline' | 'ghost' | 'success' | 'danger' | 'danger-text';
type Size = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-1.5 border-[1.5px] rounded-btn ' +
  'font-medium leading-tight whitespace-nowrap no-underline cursor-pointer ' +
  'transition-[background,color,border-color,opacity,transform,box-shadow] ' +
  'focus-ring enabled:active:scale-[0.97] ' +
  // One disabled treatment for every variant (#693): dimmed and inert-looking, so a
  // disabled danger button can't read as a pastel one. Pair it with a `title` that
  // says why.
  'disabled:opacity-50 disabled:cursor-not-allowed';

// Sizes sit on control heights (#693) so a button lines up with the Input / Select
// beside it: sm 32, md 36 (= `control-h` on a fine pointer), lg 44 (touch).
// min-h, not h: a label that wraps (fr/ru) grows instead of clipping.
const SIZE_CLASS: Record<Size, string> = {
  sm: 'min-h-8 px-3 py-1 text-meta',
  md: 'min-h-9 px-3.5 py-1.5 text-sm',
  lg: 'min-h-11 px-5 py-2 text-base',
};

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'bg-primary text-white border-primary enabled:hover:bg-primary-dark enabled:hover:border-primary-dark btn-glow',
  // A record's own edit action beside navigation outlines: a translucent copper wash so
  // it leads the row without competing with the view's one solid `primary`.
  tonal: 'btn-tonal text-text',
  // `--color-control-border` is set on dark islands so hero outlines read as controls.
  outline: 'bg-transparent text-text border-[color:var(--color-control-border,var(--color-border))] enabled:hover:bg-surface-2',
  ghost: 'bg-transparent text-text-muted border-transparent enabled:hover:bg-surface-2 enabled:hover:text-text',
  success: 'bg-button-success text-white border-button-success enabled:hover:bg-button-success-hover enabled:hover:border-button-success-hover',
  // The one destructive fill (#693): solid red, on the confirm that deletes. A
  // pastel fill is not a delete button.
  danger: 'bg-button-danger text-white border-button-danger enabled:hover:bg-button-danger-hover enabled:hover:border-button-danger-hover',
  // The quiet way into a delete (#759): unfilled red text that opens a confirm, so
  // an edit panel keeps its one coloured fill (Save). The confirm itself uses `danger`.
  'danger-text': 'bg-transparent text-error border-transparent enabled:hover:bg-surface-2 enabled:hover:underline underline-offset-2',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  /** Full width (a form's submit bar) instead of hand-rolled `w-full` bars. */
  block?: boolean;
  /** React 19 ref-as-prop; forwarded to the <button> (e.g. to return focus to it). */
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * The button look for a navigation element (a `Link` that should read as a button), so
 * "Try again" / "Back to dashboard" stay real links instead of `router.push` buttons.
 */
export function buttonClass({ variant = 'primary', size = 'md', block = false }: Pick<ButtonProps, 'variant' | 'size' | 'block'> = {}): string {
  // `:enabled` only matches form controls, so on an <a> the `enabled:` hover and press
  // states would never fire. A link is never disabled, so apply them unconditionally.
  return classFor(variant, size, block).replaceAll('enabled:', '');
}

function classFor(variant: Variant, size: Size, block: boolean): string {
  return cx(BASE, SIZE_CLASS[size], VARIANT_CLASS[variant], block && 'w-full');
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  block = false,
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(classFor(variant, size, block), className)}
      {...rest}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  );
}
