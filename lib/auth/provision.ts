import { getUserSummaryByGoogleId, getUserSummaryByEmail, linkGoogleAccount, insertUser } from '@/lib/db/queries/users';
import { debugLog } from '@/lib/logger';
import { AccessError } from '@/lib/data/errors';

/**
 * Node-only user provisioning. Imported by the NextAuth **Node** instance
 * (`lib/auth/auth.ts`) and by `getUserFromRequest` — never by the edge middleware
 * (`proxy.ts`), which must stay free of `pg`. Keep DB access out of `auth.config.ts`.
 */

export interface ProvisionInput {
  googleId: string;
  email: string;
  name: string | null;
  image: string | null;
  /**
   * Google's `email_verified`. Only a verified address may take over an
   * existing email-only Users row (#51, L-10); unknown counts as unverified.
   */
  emailVerified: boolean;
}

export interface ProvisionedUser {
  id: number;
  email: string;
  name: string | null;
}

/**
 * Resolve the DB `Users` row for a Google account, creating it (or linking a
 * GoogleId onto an existing email-only row) if needed. Idempotent — safe to call
 * on every sign-in. This is the single source of truth for user provisioning,
 * shared by the jwt callback (at sign-in, to seed the token) and
 * `getUserFromRequest` (as the fallback for tokens minted before #12).
 */
export async function resolveOrCreateUser(input: ProvisionInput): Promise<ProvisionedUser> {
  const { googleId, email, name, image, emailVerified } = input;

  // Fast: already provisioned, keyed by GoogleId.
  const existing = await getUserSummaryByGoogleId(googleId);
  if (existing) {
    return { id: existing.Id, email: existing.Email, name: existing.Name };
  }

  // Not found by GoogleId — link to an existing email-only row (legacy users).
  const linkable = await getUserSummaryByEmail(email);
  if (linkable && !emailVerified) {
    // Someone else's history must not pass to an account whose address Google
    // hasn't verified (#51, L-10).
    throw new AccessError('This Google account’s email address is not verified');
  }
  if (linkable) {
    await linkGoogleAccount(linkable.Id, googleId, name, image);
    debugLog('[Auth] Linked GoogleId to an existing user');
    return { id: linkable.Id, email: linkable.Email, name };
  }

  // First sign-in — create the row.
  const row = await insertUser({ email, name, image, googleId });
  debugLog('[Auth] Created a new user in the database');
  return { id: row.Id, email: row.Email, name: row.Name };
}
