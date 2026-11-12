'use client';

import { cx } from './cx';

type CoverBandVariant = 'cover' | 'short' | 'flat';

export interface CoverBandProps {
  /**
   * - `cover`: the 144px band of the person, family and home pages (#55). Pass
   *   `portrait` to hang a 4:3 portrait over its lower edge, with `lead` beside it.
   * - `short`: the list and Tools pages' band: eyebrow, title, counts line.
   * - `flat`: the same band without the gradient (a place with no pin, #56).
   * All three draw only from the hero tokens (`.hero-dark`, #1246), so light mode
   * is ink navy and dark mode keeps the warm umber.
   */
  variant?: CoverBandVariant;
  /** Sans uppercase label above the title ("Your tree", "Research case"). */
  eyebrow?: React.ReactNode;
  /** The page's `h1`. */
  title: React.ReactNode;
  titleId?: string;
  /** Type recipe: `hero` 40 (Person), `record` 32 (Family, Case, Place), `page` 28 (lists). */
  titleSize?: 'hero' | 'record' | 'page';
  /** The metadata line under the title. Years inside it use `.date-mono`. */
  meta?: React.ReactNode;
  /**
   * The optional actions slot, top-right (C1 on #55): the ⋯ menu on Person, Family
   * and Place, plus "Answer and close" on a Research case. Home, the list pages and
   * the Tools pages leave it empty.
   */
  actions?: React.ReactNode;
  /** `cover` only: the hanging portrait (a `PortraitFrame`-like 4:3 element). */
  portrait?: React.ReactNode;
  /** `cover` only: the lead text beside the portrait (`LeadText`). */
  lead?: React.ReactNode;
  className?: string;
}

const TITLE_CLASS = { hero: 'title-hero', record: 'title-record', page: 'title' } as const;
const DEFAULT_TITLE: Record<CoverBandVariant, keyof typeof TITLE_CLASS> = { cover: 'record', short: 'page', flat: 'record' };

/**
 * The v1.1 desktop band (#55). It replaces the old portrait hero's card layout on
 * the pages that move to it; phones keep their own `RecordBand`.
 *
 * With a portrait, the band reserves the portrait column on its left and the
 * portrait hangs over the band's lower edge. The lead text sits beside the
 * portrait, below the band, so opening "Read all" grows the page downward and
 * never moves the portrait.
 */
export function CoverBand({
  variant = 'cover',
  eyebrow,
  title,
  titleId,
  titleSize,
  meta,
  actions,
  portrait,
  lead,
  className,
}: CoverBandProps) {
  const hasPortrait = variant === 'cover' && portrait != null;
  const size = titleSize ?? DEFAULT_TITLE[variant];
  return (
    <header className={cx('cover', hasPortrait && 'cover--portrait', className)}>
      <div className={cx('hero-dark cover-band', `cover-band--${variant}`)}>
        <div className="cover-band__text">
          {eyebrow && <div className="eyebrow cover-band__eyebrow">{eyebrow}</div>}
          <h1 id={titleId} className={cx(TITLE_CLASS[size], 'm-0 cover-band__title')}>{title}</h1>
          {meta && <div className="cover-band__meta">{meta}</div>}
        </div>
        {actions && <div className="cover-band__actions">{actions}</div>}
      </div>
      {variant === 'cover' && (hasPortrait || lead != null) && (
        <div className="cover-below">
          {hasPortrait && <div className="cover-portrait">{portrait}</div>}
          {lead != null && <div className="cover-lead">{lead}</div>}
        </div>
      )}
    </header>
  );
}
