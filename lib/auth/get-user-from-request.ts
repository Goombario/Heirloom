import { auth } from '@/lib/auth/auth';
import { getUserSummaryByGoogleId, insertUser } from '@/lib/db/queries/users';
import { debugLog } from '@/lib/logger';
import { hasPlaceholderAuthSecret } from '@/lib/config-guard';
import { hasActiveMembership } from './membership';
import { resolveOrCreateUser } from './provision';
import { AccessError } from '@/lib/data/errors';

export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string | null;
  googleId: string;
}

interface SessionUser {
  email?: string | null;
  name?: string | null;
  image?: string | null;
  googleId?: string;
}

export function isDesktopMode(): boolean {
  return process.env.DESKTOP_MODE === 'true';
}

let desktopUserCache: AuthenticatedUser | null = null;

async function getDesktopUser(): Promise<AuthenticatedUser> {
  if (desktopUserCache) return desktopUserCache;

  const email = 'local@desktop';
  const googleId = 'desktop-local';

  let dbUser = await getUserSummaryByGoogleId(googleId);

  if (!dbUser) {
    dbUser = await insertUser({ email, name: 'Local User', image: null, googleId });
    debugLog('[Auth] Created desktop local user');
  }

  desktopUserCache = {
    id: dbUser.Id,
    email: dbUser.Email,
    name: dbUser.Name,
    googleId,
  };

  return desktopUserCache;
}

/**
 * Extract authenticated user from the current request.
 * Returns user object or null if not authenticated.
 * Use this in API routes to check authentication and get user context.
 *
 * In desktop mode (DESKTOP_MODE=true), returns a local user without requiring
 * Google OAuth. All other callers go through the standard NextAuth session.
 *
 * This function also ensures the user exists in the database,
 * creating a new record if this is their first API call after sign-in.
 */
export async function getUserFromRequest(): Promise<AuthenticatedUser | null> {
  if (isDesktopMode()) {
    try {
      return await getDesktopUser();
    } catch (err) {
      console.error('[Auth] Desktop user lookup failed:', err);
      return null;
    }
  }

  // The proxy refuses these requests already; this covers the paths its matcher skips.
  if (hasPlaceholderAuthSecret()) return null;

  const session = await auth();

  if (!session?.user?.email) {
    return null;
  }

  const googleId = (session.user as SessionUser).googleId;

  if (!googleId) {
    return null;
  }

  // Fast path (#12): the DB id was provisioned into the token at sign-in, so no
  // lookup is needed to identify the user. The token is signature-verified by
  // NextAuth, so this id is trustworthy; every data query is still gated by
  // validateTreeAccess, so authorization never relies on it.
  let user: AuthenticatedUser;
  if (typeof session.user.dbUserId === 'number') {
    user = {
      id: session.user.dbUserId,
      email: session.user.email,
      name: session.user.name ?? null,
      googleId,
    };
  } else {
    // Fallback: tokens minted before #12 (or a jwt-provisioning failure) — resolve
    // and provision now, via the same helper the jwt callback uses.
    // The session doesn't carry Google's flag, so this path never links by email:
    // an email-only legacy row makes it throw, and the user is sent to sign in
    // again, where the verified flag is known (#51, L-2).
    const provisioned = await resolveOrCreateUser({
      googleId,
      emailVerified: false,
      email: session.user.email,
      name: session.user.name ?? null,
      image: session.user.image ?? null,
    }).catch((error: unknown) => {
      if (error instanceof AccessError) return null;
      throw error;
    });
    if (!provisioned) return null;
    user = { id: provisioned.id, email: provisioned.email, name: provisioned.name, googleId };
  }

  // Membership is re-checked on every request (ADR 0029): a revoked member's
  // 30-day session stops at the next API call. Matched by user AND Google account.
  if (!(await hasActiveMembership(user.id, googleId))) {
    return null;
  }

  return user;
}
