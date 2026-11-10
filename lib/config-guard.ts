/**
 * Startup safety check for the DESKTOP_MODE auth bypass (see proxy.ts).
 *
 * DESKTOP_MODE=true skips ALL authentication so every request is served as the
 * single local user — correct for a personal desktop or a single-user Postgres,
 * but dangerous against a shared/hosted (multi-tenant) database. We warn rather
 * than throw: a single-user hosted Postgres + desktop is a legitimate setup, so
 * this is a loud breadcrumb for an operator who has likely misconfigured, not a
 * hard failure. (security review findings 14 §2/§5/§6)
 */

/** True when DATABASE_URL points at a non-local host (a likely hosted DB). */
function hostLooksRemote(databaseUrl: string): boolean {
  try {
    const host = new URL(databaseUrl).hostname.toLowerCase();
    // No host → unix socket / local. Loopback hosts are local.
    if (!host) return false;
    return !['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host);
  } catch {
    return false; // Unparseable → don't cry wolf.
  }
}

let checked = false;

/** Log a prominent warning if DESKTOP_MODE is on in production against a remote DB. Runs once. */
export function assertDesktopModeSafe(): void {
  if (checked) return;
  checked = true;

  const dbUrl = process.env.DATABASE_URL;
  if (
    process.env.DESKTOP_MODE === 'true' &&
    process.env.NODE_ENV === 'production' &&
    dbUrl &&
    hostLooksRemote(dbUrl)
  ) {
    console.error(
      '[config] SECURITY WARNING: DESKTOP_MODE=true bypasses all authentication, ' +
        'but DATABASE_URL points at a remote/hosted database in production. Every ' +
        'request is served as the single local user. If this database is shared or ' +
        'multi-tenant, UNSET DESKTOP_MODE immediately.',
    );
  }
}

/**
 * AUTH_SECRET values this repository publishes: the `.env.example` placeholder and
 * the throwaway values CI and the build docs use. Sessions signed with one of them
 * can be forged by anyone who has read the source.
 */
const PUBLISHED_AUTH_SECRETS = new Set([
  'your-secret-key-here',
  'test-secret-for-ci',
  'unused-in-static-build',
  'x',
]);

export const PLACEHOLDER_AUTH_SECRET_MESSAGE =
  'Server misconfigured: AUTH_SECRET is a placeholder value. Set it to a random string ' +
  '(openssl rand -base64 32) and restart.';

let placeholderSecretLogged = false;

/**
 * True when a hosted production server runs with a published AUTH_SECRET. The
 * proxy and `getUserFromRequest` then refuse every request, so a copied
 * `.env.example` fails loudly instead of running with forgeable sessions.
 * Development, tests and desktop mode (no sessions) are left alone.
 */
export function hasPlaceholderAuthSecret(): boolean {
  if (process.env.NODE_ENV !== 'production' || process.env.DESKTOP_MODE === 'true') return false;
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || !PUBLISHED_AUTH_SECRETS.has(secret)) return false;
  if (!placeholderSecretLogged) {
    placeholderSecretLogged = true;
    console.error(`[config] ${PLACEHOLDER_AUTH_SECRET_MESSAGE}`);
  }
  return true;
}
