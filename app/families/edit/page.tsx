import { Suspense } from 'react';
import FamilyEditView from './FamilyEditView';

// Static query-param route (/families/edit?id=). useSearchParams() requires a
// Suspense boundary during prerender under output:'export'.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <FamilyEditView />
    </Suspense>
  );
}
