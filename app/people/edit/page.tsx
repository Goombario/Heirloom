import { Suspense } from 'react';
import EditRedirect from './EditRedirect';

// The standalone /people/edit page was retired — editing now happens inline on
// the detail page (/people/view). This route is kept only as a redirect so old
// deep-links (and bookmarks) still resolve. It preserves the ?id query param.
//
// The redirect is client-side on purpose: under output:'export' (static build)
// query params are runtime-only, so a server redirect() reading ?id can't work
// on a prerendered page. useSearchParams() also requires a Suspense boundary.
export default function Page() {
    return (
        <Suspense fallback={null}>
            <EditRedirect />
        </Suspense>
    );
}
