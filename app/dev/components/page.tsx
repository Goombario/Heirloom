import { notFound } from 'next/navigation';
import DevComponentsContent from './DevComponentsContent';

/**
 * Dev-only components page (#55). It shows every v1.1 desktop shared component in
 * its states (editor, contributor, viewer; empty, partial, full; light and dark)
 * with made-up sample data, so page builds and the family prototype (#54) can be
 * checked against one place, and the a11y scans reach every component.
 *
 * Not linked from any nav, and 404s outside development like `/a11y-harness`:
 * `next build` runs with NODE_ENV=production for the hosted and static builds.
 */
export default function Page() {
    if (process.env.NODE_ENV === 'production') {
        notFound();
    }
    return <DevComponentsContent />;
}
