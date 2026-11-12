'use client';

import { cx } from './cx';

export interface DetailRailProps {
  /** Sticky-follow the scroll (person and family rails are sticky). */
  sticky?: boolean;
  /**
   * `cards` (default): today's shadowless hairline cards (#764).
   * `open`: the v1.1 desktop rail (#55): no cards and no bars, sections separated by
   * about 36px of space only (C4). Use it inside `DetailBody`.
   */
  look?: 'cards' | 'open';
  className?: string;
  children: React.ReactNode;
}

const STICKY = 'sticky top-[80px] self-start';

/**
 * Tier-3 of the elevation ladder: the right-column rail. One recipe on every
 * detail surface (Person, Family, Case, Place, Home; #764): shadowless hairline
 * cards on the page background, each with its heading inside
 * (`SectionHeader level="rail"`, a hairline rule). No grey well. The v1.1 pages
 * use `look="open"`.
 */
export function DetailRail({ sticky = false, look = 'cards', className = '', children }: DetailRailProps) {
  return (
    <div className={cx(look === 'open' ? 'rail-open flex flex-col' : 'person-rail flex flex-col gap-4', sticky && STICKY, className)}>
      {children}
    </div>
  );
}
