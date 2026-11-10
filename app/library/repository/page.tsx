'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import RecordNotFound from '@/app/components/RecordNotFound';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { MobileRepositoryPage } from '../mobile/MobileRepositoryPage';

/**
 * `/library/repository?id=<id>`: a repository's own page on phones (#1119). Desktop
 * keeps the repository modal over the Library, so it goes there instead.
 */
function RepositoryRoute() {
  const router = useRouter();
  const id = useSearchParams().get('id');
  const valid = !!id && /^\d+$/.test(id);
  const isMobile = useIsMobile();
  useEffect(() => {
    // matchMedia too: useIsMobile reads false while hydrating, and a phone must not be sent on.
    if (valid && !isMobile && !window.matchMedia('(max-width: 767px)').matches) router.replace(`/library?tab=sources&repo=${id}`);
  }, [router, id, valid, isMobile]);
  if (!valid) return <RecordNotFound record="repository" />;
  return isMobile ? <MobileRepositoryPage key={id} repositoryId={Number(id)} /> : null;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RepositoryRoute />
    </Suspense>
  );
}
