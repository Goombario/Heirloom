import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

export const authConfig = {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      authorization: { params: { prompt: 'select_account' } },
    }),
  ],
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  callbacks: {
    // No signIn callback here: who may sign in is a database check (the "Members"
    // table, ADR 0029), so it lives on the Node instance in lib/auth/auth.ts. This
    // config is also imported by the edge proxy, which must stay free of `pg`.
    async jwt({ token, account, profile }) {
      // On first sign-in, store Google profile info
      if (account && profile) {
        token.email = profile.email;
        token.name = profile.name;
        token.picture = profile.picture;
        token.googleId = profile.sub ?? undefined;
        token.sub = profile.sub ?? undefined; // Use Google ID as token subject
        token.locale = (profile as { locale?: string }).locale;
      }
      // Token values persist automatically on subsequent calls
      return token;
    },
    async session({ session, token }) {
      // Pass all info to session. Reading token fields only — no DB — so this
      // stays safe to run in the edge middleware.
      if (session.user && token.googleId) {
        session.user.email = token.email as string;
        session.user.name = token.name as string;
        session.user.image = token.picture as string;
        session.user.googleId = token.googleId as string;
        session.user.locale = token.locale as string | undefined;
        // DB id seeded at sign-in by the Node jwt callback (#12); absent on
        // tokens minted before that change, so it stays optional.
        if (typeof token.userId === 'number') {
          session.user.dbUserId = token.userId;
        }
      }
      return session;
    },
    async authorized({ auth, request: { nextUrl } }) {
      // Only "is there a session". A revoked member's session still passes here,
      // and every API call refuses it on the Node path (getUserFromRequest).
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');

      if (isOnDashboard) {
        if (isLoggedIn) return true;
        return false; // Redirect unauthenticated users to sign-in page
      } else if (isLoggedIn) {
        return true;
      }
      return true;
    },
  },
  session: {
    strategy: 'jwt' as const,
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.AUTH_SECRET,
  trustHost: true,
} satisfies NextAuthConfig;
