import { Suspense } from 'react';
import CaseDetailView from '../view/CaseDetailView';

// Dedicated new-case route. Renders the case shell in draft mode: the header
// autosaves ~650ms after the title is set, then routes to the created case
// where the journal-area guided start continues. useSearchParams inside the
// shell needs a Suspense boundary under output:'export'.
export default function NewCasePage() {
    return (
        <Suspense fallback={null}>
            <CaseDetailView forceDraft />
        </Suspense>
    );
}
