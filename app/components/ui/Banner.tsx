'use client';

import React from 'react';
import { cx } from './cx';

type BannerTone = 'error' | 'success' | 'warning' | 'info';

const TONE: Record<BannerTone, { box: string; role: 'alert' | 'status' }> = {
  error: {
    box: 'bg-[color:var(--error-bg)] border-[color:var(--error)] text-[color:var(--error)]',
    role: 'alert',
  },
  success: {
    box: 'bg-[color:var(--success-bg)] border-[color:var(--success)] text-[color:var(--success)]',
    role: 'status',
  },
  warning: {
    box: 'bg-[color:var(--warning-bg)] border-[color:var(--warning-text)] text-[color:var(--warning-text)]',
    role: 'alert',
  },
  // Neutral, non-urgent context — nothing has gone wrong and nothing is
  // required of the reader (#592's "already in this tree" summary). 'status'
  // rather than 'alert' so it does not interrupt a screen reader mid-sentence.
  info: {
    box: 'bg-[color:var(--info-bg)] border-[color:var(--info-text)] text-[color:var(--info-text)]',
    role: 'status',
  },
};

export interface BannerProps {
  tone: BannerTone;
  /** Optional leading icon — inherits the tone foreground via `currentColor`. */
  icon?: React.ReactNode;
  /** Icon/content vertical alignment — 'center' for single-line, 'start' for wrapping bodies. */
  align?: 'start' | 'center';
  /** ARIA role override; defaults to 'alert' (error/warning) or 'status' (success). */
  role?: React.AriaRole;
  className?: string;
  children: React.ReactNode;
}

/**
 * Tinted inline alert — the error/success/warning message boxes repeated across
 * person-form desktop+mobile and `FamilyForm` (#175 Wave 2). Rounded, bordered, and
 * tone-tinted; the foreground color flows to both the text and any icon via
 * `currentColor`. Layout margin stays at the call site via `className`.
 */
export function Banner({ tone, icon, align = 'start', role, className = '', children }: BannerProps) {
  const t = TONE[tone];
  return (
    <div
      role={role ?? t.role}
      className={cx(
        'flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm',
        align === 'center' ? 'items-center' : 'items-start',
        t.box,
        className,
      )}
    >
      {icon && <span className="shrink-0" aria-hidden="true">{icon}</span>}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
