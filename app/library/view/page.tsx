'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import RecordNotFound from '@/app/components/RecordNotFound';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { MobileSourcePage } from '../mobile/MobileSourcePage';
import { librarySourceHref } from '@/app/library/links';

/**
 * `/library/view?id=<id>`: on phones, the source's own page (#1119). On desktop the
 * source opens as a `SourceModal` over the library list (Task 2.3), so this maps the
 * `?id=` param onto `/library?source=<id>` and bookmarks and cited-by links keep working.
 *
 * Implemented client-side (not a server `redirect()`) so it also works under
 * `output: 'export'` for the static / local-first build.
 */
function ViewRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const valid = !!id && /^\d+$/.test(id);
  const isMobile = useIsMobile();

  useEffect(() => {
    // matchMedia too: useIsMobile reads false while hydrating, and a phone must not be sent on.
    if (valid && id && !isMobile && !window.matchMedia('(max-width: 767px)').matches) router.replace(librarySourceHref(id));
  }, [router, id, valid, isMobile]);

  // A malformed id can't name a source: say so rather than silently showing the list (#697).
  // A well-formed but missing id lands on SourceModal's matching not-found state.
  if (!valid) return <RecordNotFound record="source" />;
  return isMobile ? <MobileSourcePage key={id} sourceId={Number(id)} /> : null;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ViewRedirect />
    </Suspense>
  );
}
