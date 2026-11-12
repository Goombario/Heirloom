'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Redirects legacy /families/edit?id=<id> links to the detail page, which now owns
 * all inline editing. id=new goes to /families/new, which opens New family over the
 * Families list. Client-side because static-export can't read runtime query params
 * in a server redirect.
 */
export default function EditFamilyClient() {
    const router = useRouter();
    const id = useSearchParams().get('id') ?? '';
    useEffect(() => {
        if (id === 'new') router.replace('/families/new');
        else if (id) router.replace(`/families/view?id=${encodeURIComponent(id)}`);
        else router.replace('/families');
    }, [id, router]);
    return null;
}
