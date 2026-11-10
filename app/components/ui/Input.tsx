import React from 'react';
import { cx } from './cx';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  size?: 'sm' | 'md';
  wrapClassName?: string;
}

const FIELD_CHROME =
  'border border-border rounded-md bg-card text-text transition ' +
  'focus-ring';
const FIELD_BASE = 'w-full ' + FIELD_CHROME;
// The single source of truth for form-field typography and chrome (#331):
// md = standard fields (text-base / 14px), sm = compact fields (text-sm / 13px).
// Both sizes are below 16px, so both carry the `.input-nozoom` iOS auto-zoom
// guard (font-size bump to 16px on coarse pointers only — no padding, so the
// `pl-9` icon padding below can't be overridden; see the icon-padding test).
//
// Heights match Button (#693): md 36 (`control-h` on a fine pointer), sm 32, so an
// input, a select and a button in one row line up. min-h, not h, because textareas
// share this string.
const FIELD_SIZE = {
  md: 'input-nozoom min-h-9 text-base px-3.5 py-1.5',
  sm: 'input-nozoom min-h-8 text-sm px-3 py-1',
} as const;

/**
 * Field chrome + sizing as a plain utility string, for form controls the
 * `Input` primitive can't wrap (`SelectField`, `<textarea>`, DateInput,
 * LocationField, …). Replaces the retired unlayered `.input-field` /
 * `.input-field-sm` classes (#331) — as utilities, call-site utility
 * overrides now win the cascade as expected.
 *
 * `width` defaults to `w-full`. Pass a different width utility string here
 * (NOT via extra className) so the string never contains two competing
 * width utilities — Tailwind's stylesheet order, not markup order, would
 * decide that fight.
 */
export function fieldClass(size: 'sm' | 'md' = 'md', width = 'w-full'): string {
  return cx(width, FIELD_CHROME, FIELD_SIZE[size]);
}

export function Input({ label, hint, icon, size = 'md', className = '', wrapClassName = '', ...rest }: InputProps) {
  return (
    <label className={cx('block', wrapClassName)}>
      {label && <span className="block text-sm font-medium text-text-secondary mb-1.5">{label}</span>}
      <span className="relative flex items-center">
        {icon && <span className="absolute left-3 flex text-text-muted pointer-events-none">{icon}</span>}
        <input className={cx(FIELD_BASE, FIELD_SIZE[size], icon ? 'pl-9' : '', className)} {...rest} />
      </span>
      {hint && <span className="block text-xs text-text-muted mt-1.5">{hint}</span>}
    </label>
  );
}
