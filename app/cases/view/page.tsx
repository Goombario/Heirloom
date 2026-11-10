import { Suspense } from 'react';
import CaseDetailView from './CaseDetailView';

// Static query-param route (/cases/view?id=). useSearchParams() requires a
// Suspense boundary during prerender under output:'export'.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <CaseDetailView />
    </Suspense>
  );
}
