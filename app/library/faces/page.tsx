'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageShell } from '@/app/components/ui';

/** Compatibility entry point for bookmarks to the former Faces route. */
export default function FacesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/library?tab=faces');
  }, [router]);

  return (
    <PageShell busy>
      <div className="min-h-[240px]" />
    </PageShell>
  );
}
