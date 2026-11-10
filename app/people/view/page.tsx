import { Suspense } from 'react';
import PersonDetailView from './PersonDetailView';
import { DetailSkeleton } from '@/app/components/SkeletonLoader';

// Static query-param route (/people/view?id=). useSearchParams() requires a Suspense
// boundary during prerender under output:'export'; the fallback is the same
// DetailSkeleton the view renders while loading, so the hand-off is seamless.
//
// Do NOT rely on this fallback to cover the hard-load blank. Measured 2026-07-28 on
// the hosted build: the view renders server-side WITHOUT suspending, so this fallback
// never fires and it is the view's own `pending` branch that lands in the prerendered
// HTML. The no-blank guarantee comes from `usePersonDetail`'s cold-load `delay: 0`.
export default function Page() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <PersonDetailView />
    </Suspense>
  );
}
