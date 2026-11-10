import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/auth.config';
import { assertDesktopModeSafe, hasPlaceholderAuthSecret, PLACEHOLDER_AUTH_SECRET_MESSAGE } from '@/lib/config-guard';

// Build the auth wrapper straight from the edge-safe `authConfig` — NOT from
// `@/lib/auth/auth`, whose jwt callback pulls in `pg` (via provision.ts). The
// middleware runs on the edge runtime, so it must stay free of Node-only deps
// (#12). authConfig only reads JWT fields here, never the database.
const { auth: proxy } = NextAuth(authConfig);

// Runs once on first module load (server boot): warns if DESKTOP_MODE's auth
// bypass is enabled in production against a remote/hosted database. Membership
// (who may sign in, ADR 0029) is checked on the Node path, never here: this
// proxy only checks that a session exists.
assertDesktopModeSafe();

export default proxy((req) => {
  const { pathname } = req.nextUrl;

  // Desktop mode: bypass all auth checks — route handlers manage their own auth
  if (process.env.DESKTOP_MODE === 'true') {
    return NextResponse.next();
  }

  // A published AUTH_SECRET makes every session forgeable: serve nothing, sign-in included.
  if (hasPlaceholderAuthSecret()) {
    return new NextResponse(PLACEHOLDER_AUTH_SECRET_MESSAGE, { status: 500 });
  }

  // Allow public access to auth routes, and to the desktop-mode probe every page
  // makes before anyone can have signed in (#933). It returns only a boolean.
  if (pathname.startsWith('/api/auth') || pathname === '/api/desktop') {
    return NextResponse.next();
  }

  // Protect all /api/* routes except /api/auth
  if (pathname.startsWith('/api')) {
    const isAuthenticated = !!req.auth;

    if (!isAuthenticated) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
  }

  // Allow all other routes (frontend pages)
  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
