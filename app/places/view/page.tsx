import { Suspense } from 'react';
import PlaceDetailView from './PlaceDetailView';

// Static query-param route (/places/view?id=, or ?name=). useSearchParams() requires a
// Suspense boundary during prerender under output:'export'.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <PlaceDetailView />
    </Suspense>
  );
}
