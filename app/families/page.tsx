import { Suspense } from 'react';
import { connection } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { listFamiliesService, type ListFamiliesResult } from '@/lib/services/families';
import FamiliesPageClient from './FamiliesPageClient';

export default async function FamiliesPage() {
  if (process.env.BUILD_TARGET === 'static') {
    // No server to render on in the static export — the client's own fetch
    // (PGlite, warmed in parallel by DbWarmup) handles this. Short-circuits
    // BEFORE any dynamic API so the static export can fully prerender the shell.
    return <Suspense fallback={null}><FamiliesPageClient initialFamilies={null} /></Suspense>;
  }

  // Opt this route out of static prerendering for the hosted build so it runs
  // per request against the real session. Without this, `next build` renders the
  // component once at build time (no session → initialFamilies=null baked into
  // static HTML) and serves it to every user — a silent no-op. connection() is
  // reached only in the hosted build; the static export returns above.
  await connection();

  let initialFamilies: ListFamiliesResult | null = null;
  try {
    const user = await getUserFromRequest();
    if (user) {
      // Default-tree only — TreeContext always initializes activeTreeId to null
      // (= the current user's default tree) on a fresh load, so this matches what
      // the client would fetch anyway on a fresh navigation. The client seeds it
      // into the default-scope cache key; a restored non-default selection just
      // misses that key and refetches.
      initialFamilies = await listFamiliesService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: user.id });
    }
  } catch (e) {
    // Re-throw framework control-flow signals (redirect/not-found/dynamic
    // bailout) instead of swallowing them; a genuine unauthenticated or
    // access-denied error falls through to the null fallback, which the client
    // component already handles with its own loading/empty/error states.
    unstable_rethrow(e);
    initialFamilies = null;
  }

  // useSearchParams (`?add=1`) needs a Suspense boundary.
  return <Suspense fallback={null}><FamiliesPageClient initialFamilies={initialFamilies} /></Suspense>;
}
