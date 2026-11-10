'use client';
import React from 'react';
import { cx } from './cx';

export interface SectionHeaderProps {
  title: React.ReactNode;
  /** Muted "(n)" suffix; rendered only when > 0. */
  count?: number;
  /** Trailing control (e.g. a ghost Button). */
  action?: React.ReactNode;
  /** Muted line under the title (used by Names & aliases). */
  subtitle?: React.ReactNode;
  /**
   * 'section' → h2, serif 18; 'rail' → h3, serif 16; 'eyebrow' → h3, sans 11
   * caps (#687). This is the only way to render these headings.
   */
  level?: 'section' | 'rail' | 'eyebrow';
  className?: string;
  /** Id on the heading, for a region's `aria-labelledby`. */
  headingId?: string;
}

/**
 * The shared "heading (count) … action" row used across the detail pages, plus an
 * optional muted subtitle. Consolidates the flex row + h2/h3 typography that was
 * re-typed inline on every section. Sizes come from the heading recipes in
 * globals.css (`.section`, `.rail-title`, `.eyebrow`), the #687 type ramp. `rail` is the one rail-card
 * header anatomy: title left, action right, hairline under (#694).
 */
export function SectionHeader({ title, count, action, subtitle, level = 'section', className = '', headingId }: SectionHeaderProps) {
  const countSuffix =
    count != null && count > 0 ? (
      <span className="font-sans muted font-normal text-meta"> ({count})</span>
    ) : null;
  const heading =
    level === 'eyebrow' ? (
      <h3 id={headingId} className="eyebrow m-0">{title}{countSuffix}</h3>
    ) : level === 'rail' ? (
      <h3 id={headingId} className="rail-title m-0">{title}{countSuffix}</h3>
    ) : (
      <h2 id={headingId} className="section m-0">{title}{countSuffix}</h2>
    );
  // A rail card's header always carries a rule under it (#694, LAY-4), so every rail
  // card reads the same whether or not its body starts with its own rule. It is the
  // heavier 2px rule, above the 1px hairlines between rows inside the card.
  return (
    <div className={cx('flex items-baseline justify-between mb-3', level === 'rail' && 'pb-2 border-b border-border-light', className)}>
      <div className="min-w-0">
        {heading}
        {subtitle && <div className="muted text-meta mt-0.5">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}
