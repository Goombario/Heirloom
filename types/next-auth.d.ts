import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      /** DB Users.Id, seeded from the JWT at sign-in (#12). A distinct field from
       *  NextAuth's string `id` (which is the Google sub). Optional: tokens minted
       *  before #12 lack it, so readers fall back to /api/users/me. */
      dbUserId?: number;
      googleId: string;
      locale?: string;
    } & DefaultSession['user'];
  }

  interface User {
    googleId?: string;
    locale?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    googleId?: string;
    locale?: string;
    /** DB Users.Id, resolved + cached at sign-in so the client can seed the
     *  active owner without an /api/users/me round-trip (#12). */
    userId?: number;
    /** Set when pending shares (#1228) for this verified address couldn't be
     *  applied at sign-in; later requests retry until it works. */
    pendingSharesRetry?: boolean;
  }
}
