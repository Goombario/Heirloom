'use client';
import React from 'react';
import { cx } from './cx';
import { SectionHeader, type SectionHeaderProps } from './SectionHeader';

type DetailSectionProps = Omit<SectionHeaderProps, 'level' | 'className'> & {
  className?: string;
  children: React.ReactNode;
};

/**
 * A main-column section on a detail page: one card with its heading inside,
 * matching the rail cards beside it (#764). The panel inside keeps rendering its
 * own `.card`; `.detail-section > .card` flattens it into this one, so panels
 * need no second, card-less mode.
 */
export function DetailSection({ className, children, ...header }: DetailSectionProps) {
  return (
    <section className={cx('card detail-section', className)}>
      <div className="px-4 pt-3.5 pb-3">
        <SectionHeader {...header} className="mb-0" />
      </div>
      {children}
    </section>
  );
}
