'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Add person opens over the People list (#52, #1065): a quick-add dialog on a wider
 * screen, a sheet on a phone. This route keeps old links working.
 */
export default function NewPersonPage() {
    const router = useRouter();
    useEffect(() => { router.replace('/people?add=1'); }, [router]);
    return null;
}
