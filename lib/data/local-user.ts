import { getUserSummaryByGoogleId, insertUser } from '@/lib/db/queries/users';

const LOCAL_GOOGLE_ID = 'local-web';
const LOCAL_EMAIL = 'local@web';

// Memoize the in-flight promise (not just the id) so concurrent first calls
// share one lookup-or-insert and can't double-insert against UNIQUE(GoogleId).
// Same idiom as dbPromise in connection.pglite.ts and clientPromise in data/index.ts.
let cachedIdPromise: Promise<number> | null = null;

async function resolveLocalUserId(): Promise<number> {
  const existing = await getUserSummaryByGoogleId(LOCAL_GOOGLE_ID);
  if (existing) {
    return existing.Id;
  }

  const inserted = await insertUser({
    email: LOCAL_EMAIL,
    name: 'Local User',
    image: null,
    googleId: LOCAL_GOOGLE_ID,
  });
  return inserted.Id;
}

/**
 * Ensure the single implicit local user exists and return its id. The static
 * build has no auth, so all data is owned by this one user. Mirrors the
 * desktop-user seeding pattern in get-user-from-request.ts.
 */
export function ensureLocalUser(): Promise<number> {
  if (!cachedIdPromise) {
    cachedIdPromise = resolveLocalUserId().catch((err) => {
      // Allow a retry on failure rather than caching a rejected promise.
      cachedIdPromise = null;
      throw err;
    });
  }
  return cachedIdPromise;
}

/** TEST ONLY: clear the cached id between tests. */
export function __resetLocalUserCache(): void {
  cachedIdPromise = null;
}
