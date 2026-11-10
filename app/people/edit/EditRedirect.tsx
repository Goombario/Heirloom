'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Redirects legacy /people/edit?id=<id> links to the detail page, which now
 * owns all inline editing. Preserves ?id; a missing/invalid id falls back to
 * the people list. Client-side because static-export prerendering can't read
 * runtime query params in a server redirect.
 */
export default function EditRedirect() {
    const router = useRouter();
    const id = useSearchParams().get('id') ?? '';

    useEffect(() => {
        if (id === 'new') {
            // Legacy new-person deep-link — the create form lives at /people/new.
            router.replace('/people/new');
        } else if (id) {
            router.replace(`/people/view?id=${encodeURIComponent(id)}`);
        } else {
            router.replace('/people');
        }
    }, [id, router]);

    return null;
}
