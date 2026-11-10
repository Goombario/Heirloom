import { AccessError, DatabaseInterruptedError, FileTooLargeError, NotFoundError, StorageLimitError, UnauthorizedError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';

/**
 * Client-only typed-error analog of `redirectToSignInIfUnauthorized`. On an
 * `UnauthorizedError` (only ever thrown in hosted mode — static mode has no
 * auth), send the user to the sign-in flow and report that the caller should
 * bail out. Returns false otherwise, so the caller can surface/handle the error.
 */
export function redirectIfUnauthorized(e: unknown): boolean {
  if (e instanceof UnauthorizedError) {
    window.location.href = '/api/auth/signin';
    return true;
  }
  return false;
}

/**
 * Compatibility alias for mutation callers that have not migrated to
 * `useErrorToast` yet. New read callers should use the named auth helper
 * through that hook rather than importing this alias.
 */
export function handleDataError(e: unknown): boolean {
  return redirectIfUnauthorized(e);
}

/**
 * True when the record a mutation targeted no longer exists.
 *
 * A page can outlive its data — most sharply across a GEDCOM overwrite import,
 * which wipes and re-inserts every person with a fresh id. The stale page then
 * looks healthy right up until a write 404s, and callers that only checked
 * `handleDataError` swallowed that silently. Callers should reload (or re-fetch)
 * so their existing not-found state takes over.
 */
export function isRecordGone(e: unknown): boolean {
  return e instanceof NotFoundError;
}

/** The `common.*` message keys the error toast can render. */
export type ErrorToastKey =
  | 'error_permission'
  | 'error_gone'
  | 'error_invalid'
  | 'error_file_too_large'
  | 'error_storage_full'
  | 'error_offline'
  | 'error_interrupted'
  | 'error_generic';

/**
 * A fetch rejection rather than an HTTP error: `fetch` rejects with a bare
 * `TypeError` when the request never completes. Only call it offline when the
 * browser agrees — online, a `TypeError` is far more likely a genuine bug, and
 * telling the user to check their connection would send them the wrong way.
 */
function isOfflineFailure(e: unknown): boolean {
  return e instanceof TypeError
    && typeof navigator !== 'undefined'
    && navigator.onLine === false;
}

/**
 * Map a caught value onto the `common.*` key describing it to the user.
 *
 * Pure and DOM-free so it can be unit-tested in the fast tier. The server's own
 * `error` string is deliberately never used: it is untranslated, and in the
 * static build it can be raw PGlite text (see release-readiness tracker §15.3).
 */
export function errorToastKey(e: unknown): ErrorToastKey {
  if (e instanceof AccessError) return 'error_permission';
  if (e instanceof NotFoundError) return 'error_gone';
  if (e instanceof FileTooLargeError) return 'error_file_too_large';
  if (e instanceof ValidationError) return 'error_invalid';
  if (e instanceof StorageLimitError) return 'error_storage_full';
  if (isOfflineFailure(e)) return 'error_offline';
  if (e instanceof DatabaseInterruptedError) return 'error_interrupted';
  return 'error_generic';
}
