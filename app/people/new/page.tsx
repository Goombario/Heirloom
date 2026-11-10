'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PersonForm from '@/app/components/PersonForm';
import { useIsMobile } from '@/app/hooks/useIsMobile';

export default function NewPersonPage() {
    const router = useRouter();
    const isMobile = useIsMobile();
    // On a phone, Add person is a sheet over the people list (#1065).
    useEffect(() => { if (isMobile) router.replace('/people?add=1'); }, [isMobile, router]);
    if (isMobile) return null;
    return <PersonForm mode="new" />;
}
