/**
 * Minimal debug-gated logger for server-side *operational* breadcrumbs — pool
 * lifecycle, schema init, first-call user provisioning. Silent unless
 * `DEBUG_LOGS=true`, so these never spill onto production stdout. That matters
 * for the auth path in particular, which previously logged user emails (PII) on
 * every new/updated account.
 *
 * This is only for chatty "it happened" logs. Real errors that must always
 * surface keep using `console.error` directly.
 */
const enabled = process.env.DEBUG_LOGS === 'true';

export function debugLog(...args: unknown[]): void {
  if (enabled) console.log(...args);
}
