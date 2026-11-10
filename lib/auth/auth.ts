import NextAuth from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { authConfig } from '@/auth.config';
import { resolveOrCreateUser } from './provision';
import { getUserSummaryByGoogleId } from '@/lib/db/queries/users';
import { admitSignIn } from './membership';
import { applyPendingSharesForUser } from '@/lib/services/sharing';

/**
 * The **Node** NextAuth instance — used by the API route handlers and
 * `getUserFromRequest`. It extends the edge-safe `authConfig` with a jwt callback
 * that provisions the DB user at sign-in and caches its id on the token (#12).
 *
 * The edge middleware (`proxy.ts`) must build its own instance directly from
 * `authConfig` so this DB-touching code (and `pg`) never enters the edge bundle.
 */
const nextAuth = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Who may sign in (ADR 0029): an active member, or a verified address with an
    // open invitation, which this turns into an active membership. A database
    // check, so it lives here and never in the edge-shared authConfig.
    async signIn({ profile }) {
      if (process.env.DESKTOP_MODE === 'true') return true;
      if (!profile?.sub) return false;
      try {
        return await admitSignIn({
          googleId: profile.sub,
          email: profile.email,
          emailVerified: profile.email_verified === true,
          name: profile.name ?? null,
          image: typeof profile.picture === 'string' ? profile.picture : null,
        });
      } catch (err) {
        console.error('[Auth] Membership check failed; refusing sign-in:', err);
        return false;
      }
    },
    async jwt(params) {
      // Run the edge-safe base first (copies Google profile fields on sign-in).
      const token = (await authConfig.callbacks!.jwt!(params)) as JWT;
      // On first sign-in (account + profile present), resolve/create the DB user
      // and stash its id so the client can seed the active owner without an
      // /api/users/me round-trip. Non-fatal on failure — getUserFromRequest still
      // provisions lazily as a fallback.
      const googleId = token.googleId;
      if (params.account && params.profile && googleId && token.userId == null) {
        // Trees shared with this address before the person had an account
        // (#1228). Only a verified address may claim them.
        const claimsShares = params.profile.email_verified === true && typeof token.email === 'string';
        if (claimsShares) token.pendingSharesRetry = true;
        try {
          const user = await resolveOrCreateUser({
            googleId,
            email: token.email as string,
            name: (token.name as string | undefined) ?? null,
            image: (token.picture as string | undefined) ?? null,
          });
          token.userId = user.id;
          if (claimsShares && (await applyPendingSharesForUser(user.id, token.email as string)) !== null) {
            delete token.pendingSharesRetry;
          }
        } catch (err) {
          console.error('[Auth] jwt user provisioning failed (will fall back):', err);
        }
      } else if (token.pendingSharesRetry && googleId && typeof token.email === 'string') {
        // Sign-in couldn't apply them (a database error, or provisioning failed and
        // getUserFromRequest provisioned lazily): try again on this request.
        try {
          const userId = token.userId ?? (await getUserSummaryByGoogleId(googleId))?.Id;
          if (userId != null && (await applyPendingSharesForUser(userId, token.email)) !== null) {
            delete token.pendingSharesRetry;
          }
        } catch (err) {
          console.error('[Auth] Pending shares retry failed:', err);
        }
      }
      return token;
    },
  },
});

export const { handlers, auth, signIn, signOut } = nextAuth;
export default nextAuth;
