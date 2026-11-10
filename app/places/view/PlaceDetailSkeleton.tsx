'use client';

// Loading shapes for the place DETAIL body (/places/view). Mirrors the loaded
// two-column geometry — 280px map + people card on the left, recessed rail on the
// right — so the page does not reflow when the payload lands. This replaced a
// centred `{t("loading")}` text line that reserved no space at all, so a hard
// reload painted blank -> text -> data (#392).
//
// Only the BODY is skeletoned. The DetailHero above it renders from
// the `?name=` query param, which is available on the first frame, so they are
// real content immediately and must not be covered by placeholder bars.

import { useTranslations } from 'next-intl';
import { Skeleton } from '@/app/components/SkeletonLoader';
import { Card } from '@/app/components/ui/Card';
import { DetailRail } from '@/app/components/ui';

/** One person/child row: 36px avatar + two text lines inside `py-2.5`. */
function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 min-h-[44px] border-b border-border-light last:border-b-0">
      <Skeleton className="w-9 h-9 rounded-full shrink-0" />
      <div className="flex-1 flex flex-col gap-1.5">
        <Skeleton className="h-3.5 w-[38%]" />
        <Skeleton className="h-2.5 w-[24%]" />
      </div>
    </div>
  );
}

/** One `label / value` line in the recessed details rail. */
function RailLineSkeleton({ labelWidth, valueWidth }: { labelWidth: string; valueWidth: string }) {
  return (
    <div className="flex justify-between items-center gap-4 py-1">
      <Skeleton className="h-3 shrink-0" style={{ width: labelWidth }} />
      <Skeleton className="h-3" style={{ width: valueWidth }} />
    </div>
  );
}

/**
 * The place-detail body while the payload loads.
 *
 * `role="status"` + a label: every bar below is `aria-hidden`, so without it the
 * load is silent to a screen reader — the text line this replaced at least
 * announced itself. Same treatment as `ExploreSkeleton`.
 */
export default function PlaceDetailSkeleton() {
  const t = useTranslations('places');
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('loading')}
      className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_1fr] gap-4 items-start"
    >
      {/* LEFT — map well, then the connected-people card. */}
      <div>
        {/* Matches the loaded LocationMap box exactly (h-280 + mb-4): the map is
            the tallest single element here, so reserving it is most of the fix. */}
        <div
          className="mb-4 h-[280px] rounded-card border border-border"
          style={{ background: 'var(--map-well-bg)' }}
          aria-hidden="true"
        />
        {/* SectionHeader bar. */}
        <Skeleton className="h-4 w-44 mb-2.5" />
        <Card pad={false} className="overflow-hidden">
          {[0, 1, 2, 3, 4].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </Card>
      </div>

      {/* RIGHT — the details rail. Uses the real DetailRail so the rail recipe
          cannot drift from the loaded state. */}
      <DetailRail>
        <div className="card p-4 flex flex-col gap-3">
          <Skeleton className="h-3 w-24" />
          <div className="flex flex-col gap-1">
            <RailLineSkeleton labelWidth="30%" valueWidth="46%" />
            <RailLineSkeleton labelWidth="24%" valueWidth="38%" />
            <RailLineSkeleton labelWidth="28%" valueWidth="20%" />
            <RailLineSkeleton labelWidth="34%" valueWidth="12%" />
          </div>
        </div>
      </DetailRail>
    </div>
  );
}
