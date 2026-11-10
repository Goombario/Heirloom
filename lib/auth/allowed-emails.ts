/**
 * Hosted sign-in settings read from the environment.
 *
 * Keep this module edge-safe and database-free. Who may sign in is decided by the
 * "Members" table on the Node path (`lib/auth/membership.ts`, ADR 0029); these
 * helpers only read the two deployment variables that feed it at startup.
 */

/** Trim and lower-case an address, the form "Members"."Email" stores. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Parse the retired allowlist, read once to seed members (ADR 0029).
 *
 * `null` means the variable is unset. An empty array means it was set but did
 * not contain an address.
 */
export function getAllowedEmails(raw = process.env.AUTH_ALLOWED_EMAILS): string[] | null {
  if (raw === undefined) return null;

  return raw
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean);
}

/** AUTH_BOOTSTRAP_EMAIL, normalized, or null when unset or blank. */
export function getBootstrapEmail(raw = process.env.AUTH_BOOTSTRAP_EMAIL): string | null {
  const email = raw ? normalizeEmail(raw) : '';
  return email || null;
}

export function isHostedProduction(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.DESKTOP_MODE !== 'true';
}
