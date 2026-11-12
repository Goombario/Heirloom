'use client';

// Loading shapes for the Explore workspace. Each mirrors the real layout's geometry —
// the list rail, the selected-place pane and the map filling the rest (#56) — so the
// page does not reflow when the data lands. The whole
// view used to be a centred "Loading…" line, which reserved none of that space
// (review 6 §11.2.1).

import { useTranslations } from 'next-intl';
import { Skeleton } from '@/app/components/SkeletonLoader';

/**
 * Rail placeholder — header band, rows, footer band.
 *
 * Bars are `bg-card`, NOT `bg-border`: in dark mode `--color-border` and
 * `--color-card-alt` are the same `#44403c`, so border-toned bars on the
 * card-alt rail measured 1.00 contrast and the whole column rendered blank.
 * `--card` is also the tone the loaded rail's selected row takes.
 */
function RailSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-3.5 pb-3 border-b border-border-light">
        <div className="h-3.5 w-40 rounded bg-card animate-pulse" aria-hidden="true" />
      </div>
      {/* Mirrors the loaded rail's scroll container, which since #467 is
          `flex-1 min-h-0` with no height cap — the grid row (floored by the detail
          column's min-h-[360px]) sets the height for both states, so the panel no
          longer changes size on load. Row heights match DrillRow's min-h-[44px];
          the list overflows and clips exactly as the real one scrolls. */}
      <div className="flex-1 min-h-0 p-1.5 flex flex-col gap-1.5 overflow-hidden">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
          <div key={i} className="h-11 w-full shrink-0 rounded-lg bg-card animate-pulse" aria-hidden="true" />
        ))}
      </div>
      <div className="px-4 py-2.5 border-t border-border-light">
        <div className="h-3 w-24 rounded bg-card animate-pulse" aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * Detail placeholder — header band then the two body columns. Shared with
 * `ExploreDetail`, which shows it on its own while a newly selected place loads.
 *
 * Bars cannot use `.skeleton`: that fill IS `--color-card-alt` (globals.css), so
 * bars on a card-alt band measured 1.00 contrast — invisible. They use the border
 * token plus the same pulse instead.
 */
export function ExploreDetailSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="px-5 pt-5 pb-4 border-b border-border-light">
        <div className="h-7 w-52 rounded bg-border animate-pulse" aria-hidden="true" />
        <div className="h-3.5 w-32 rounded bg-border animate-pulse mt-2" aria-hidden="true" />
      </div>
      <div className="px-5 py-4">
        <Skeleton className="h-3 w-24 rounded mb-3" />
        {/* h-14: a grouped person entry is a name plus up to three reason lines. */}
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="h-14 w-full rounded mb-2" />
        ))}
      </div>
    </div>
  );
}

/** The whole Explore workspace while the place list is still loading. */
export function ExploreSkeleton() {
  const t = useTranslations('places');
  return (
    // role="status" + a label: every bar below is aria-hidden, so without this the
    // load is silent to a screen reader.
    <div role="status" aria-busy="true" aria-label={t('loading')}
      className="flex-1 min-h-0 grid grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[320px_420px_minmax(0,1fr)]">
      <div className="min-h-0 flex flex-col bg-card-alt border-r border-border"><RailSkeleton /></div>
      <div className="min-h-0 bg-card border-r border-border"><ExploreDetailSkeleton /></div>
      <div className="hidden lg:block" style={{ background: 'var(--map-well-bg)' }} aria-hidden="true" />
    </div>
  );
}
