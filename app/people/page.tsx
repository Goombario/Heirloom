import { Suspense } from 'react';
import { connection } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { listPeopleService, type ListPeopleResult } from '@/lib/services/people';
import PeoplePageClient from './PeoplePageClient';

export default async function PeoplePage() {
  if (process.env.BUILD_TARGET === 'static') {
    // No server to render on in the static export — the client's own fetch
    // (PGlite, warmed in parallel by DbWarmup — see Task 2) handles this.
    // Short-circuits BEFORE any dynamic API so the static export can fully
    // prerender this route as a shell.
    return <Suspense fallback={null}><PeoplePageClient initialPeople={null} /></Suspense>;
  }

  // Opt this route out of static prerendering for the hosted build so it runs
  // per request against the real session. Without this, `next build` renders
  // the component once at build time (no session → initialPeople=null baked
  // into static HTML) and serves it to every user — a silent no-op. connection()
  // is reached only in the hosted build; the static export returns above.
  await connection();

  let initialPeople: ListPeopleResult | null = null;
  try {
    const user = await getUserFromRequest();
    if (user) {
      // Default-tree only — the server has no localStorage, so this SSR seed is
      // always default-scope. The client seeds it into the default-scope cache
      // key; a persisted non-default selection (activeTreeId is now seeded
      // synchronously client-side) just misses that key and refetches.
      initialPeople = await listPeopleService({ requestedTreeId: null,
 requestedOwnerId: null, currentUserId: user.id });
    }
  } catch (e) {
    // Re-throw framework control-flow signals (redirect/not-found/dynamic
    // bailout) instead of swallowing them; a genuine unauthenticated or
    // access-denied error falls through to the null fallback, which the client
    // component already handles with its own loading/empty/error states.
    unstable_rethrow(e);
    initialPeople = null;
  }

  return <Suspense fallback={null}><PeoplePageClient initialPeople={initialPeople} /></Suspense>;
}
