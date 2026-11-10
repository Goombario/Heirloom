import { Suspense } from 'react';
import DataChecksView from './DataChecksView';

// Static query-param route (/data-checks?entry=…&family=…): the selected entry
// lives in the query so the browser's Back works and the static export needs no
// dynamic segment (#831). useSearchParams() needs a Suspense boundary under
// output:'export'.
export default function Page() {
    return (
        <Suspense fallback={null}>
            <DataChecksView />
        </Suspense>
    );
}
