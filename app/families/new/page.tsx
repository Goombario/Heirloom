'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * New family opens over the Families list (#52, #1066): a quick-add dialog on a wider
 * screen, a sheet on a phone. This route keeps old links working.
 */
export default function NewFamilyPage() {
    const router = useRouter();
    useEffect(() => { router.replace('/families?add=1'); }, [router]);
    return null;
}
