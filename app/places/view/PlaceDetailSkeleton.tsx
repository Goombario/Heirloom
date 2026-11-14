'use client';

// Loading shapes for the place page (/places/view). Mirrors the v1.1 layout
// (#63): the map cover with its dark foot, then the cream sheet and rail, so the
// page does not reflow when the payload lands (#392).

import { useTranslations } from 'next-intl';
import { DetailBodySkeleton, Skeleton } from '@/app/components/SkeletonLoader';

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
    <div role="status" aria-busy="true" aria-label={t('loading')}>
      {/* The v1.1 cover (#63): the map well at the loaded map's height, then the dark
          foot with the eyebrow and the place name. */}
      <div className="place-cover" data-testid="place-cover-skeleton">
        <div className="h-[340px]" style={{ background: 'var(--map-well-bg)' }} aria-hidden="true" />
        <div className="hero-dark place-cover__foot">
          <div className="min-w-0 flex-1 grid gap-2.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-[340px] max-w-full" />
            <Skeleton className="h-3 w-[240px] max-w-full" />
          </div>
        </div>
      </div>
      {/* The sheet body and rail, on the same classes as the loaded DetailBody. */}
      <DetailBodySkeleton index={false} divided={false} className="place-body" />
    </div>
  );
}
