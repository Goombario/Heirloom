'use client';
import React from 'react';
import { cx } from './cx';

export interface DetailRailProps {
  /** Sticky-follow the scroll (person and family rails are sticky). */
  sticky?: boolean;
  className?: string;
  children: React.ReactNode;
}

const STICKY = 'sticky top-[80px] self-start';

/**
 * Tier-3 of the elevation ladder: the right-column rail. One recipe on every
 * detail surface (Person, Family, Case, Place, Home; #764): shadowless hairline
 * cards on the page background, each with its heading inside
 * (`SectionHeader level="rail"`, a hairline rule). No grey well.
 */
export function DetailRail({ sticky = false, className = '', children }: DetailRailProps) {
  return (
    <div className={cx('person-rail flex flex-col gap-4', sticky && STICKY, className)}>
      {children}
    </div>
  );
}
