import { ValidationError } from '@/lib/validation';

/**
 * Errors thrown by service functions and re-thrown by data clients. The hosted
 * HttpDataClient maps HTTP status codes onto these; the future LocalDataClient
 * lets services throw them directly. The UI handles one error contract either way.
 *
 * (Input-validation failures use the existing `ValidationError` in
 * `lib/validation.ts` — do not duplicate it here.)
 */

/**
 * An uploaded file is over the per-file size limit (HTTP 413). It is a
 * `ValidationError`, so callers that only distinguish bad input keep working;
 * the UI uses the type and `limitBytes` to say the file is too large (#1215).
 */
export class FileTooLargeError extends ValidationError {
  readonly code = 'file_too_large';
  readonly limitBytes?: number;

  constructor(message = 'File too large', limitBytes?: number) {
    super(message);
    this.name = 'FileTooLargeError';
    this.limitBytes = limitBytes;
  }
}

/** The caller is authenticated but lacks permission for this tree/record (HTTP 403). */
export class AccessError extends Error {
  constructor(message = 'Access denied') {
    super(message);
    this.name = 'AccessError';
  }
}

/** The requested record does not exist (HTTP 404). */
export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Canonical primary uniqueness changed concurrently; callers may retry. */
export class PrimaryMediaConflictError extends Error {
  readonly code = 'primary_conflict';
  readonly retryable = true;

  constructor(message = 'Primary media changed concurrently') {
    super(message);
    this.name = 'PrimaryMediaConflictError';
  }
}

/** Reassignment would duplicate the unique (MediaId, PersonId) face tag. */
export class MediaTagConflictError extends Error {
  readonly code = 'media_tag_conflict';
  readonly retryable = false;

  constructor(message = 'This person is already tagged in this media') {
    super(message);
    this.name = 'MediaTagConflictError';
  }
}

/** An upload replay key was reused for different immutable bytes or owner target. */
export class MediaUploadIntentConflictError extends Error {
  readonly code = 'upload_intent_conflict';
  readonly retryable = false;

  constructor(message = 'Upload intent conflicts with existing media') {
    super(message);
    this.name = 'MediaUploadIntentConflictError';
  }
}

/**
 * A membership change the rules refuse (HTTP 409, ADR 0029): the address is already
 * listed, the change would leave no active admin, or the row isn't in a state the
 * action applies to. The page says why from `code`.
 */
export class MembershipConflictError extends Error {
  readonly retryable = false;
  readonly code: 'already_listed' | 'last_admin' | 'wrong_status';

  constructor(code: MembershipConflictError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'MembershipConflictError';
  }
}

/** The caller is not authenticated (HTTP 401). */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** A per-tree storage quota (or the disk itself) is full (HTTP 507). */
export interface StorageLimitMetadata {
  usedBytes?: number;
  limitBytes?: number;
  remainingBytes?: number;
}

export class StorageLimitError extends Error {
  readonly code = 'storage_limit';
  readonly retryable = true;
  readonly usedBytes?: number;
  readonly limitBytes?: number;
  readonly remainingBytes?: number;

  constructor(message = 'Storage limit reached', metadata: StorageLimitMetadata = {}) {
    super(message);
    this.name = 'StorageLimitError';
    this.usedBytes = metadata.usedBytes;
    this.limitBytes = metadata.limitBytes;
    this.remainingBytes = metadata.remainingBytes;
  }
}

/**
 * Converts browser quota failures into the stable storage error contract.
 *
 * Browser implementations expose quota exhaustion inconsistently: modern
 * implementations use `QuotaExceededError`, while older DOM implementations
 * expose code 22 or 1014. Do not infer quota exhaustion from an error message;
 * unrelated database errors can contain the word "quota" too.
 */
export function asStorageLimitError(error: unknown): StorageLimitError | null {
  if (error instanceof StorageLimitError) return error;
  if (!error || typeof error !== 'object') return null;

  const candidate = error as { name?: unknown; code?: unknown };
  const name = typeof candidate.name === 'string' ? candidate.name.toUpperCase() : '';
  if (
    name === 'QUOTAEXCEEDEDERROR'
    || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || name === 'QUOTA_EXCEEDED_ERR'
  ) {
    return new StorageLimitError();
  }

  if (candidate.code === 22 || candidate.code === 1014 || candidate.code === '22' || candidate.code === '1014') {
    return new StorageLimitError();
  }

  return null;
}

/** A per-user rate-limit bucket is exhausted (HTTP 429). Hosted-only: the static
 *  and desktop builds ship without `app/api`, so the Local client never throws it. */
export class RateLimitError extends Error {
  /** Seconds until the bucket has room again, when the server said. */
  readonly retryAfterSeconds?: number;

  constructor(message = 'Too many requests', retryAfterSeconds?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** A DataClient method that exists in the interface but has no implementation
 *  for the current build target yet (filled in by a later phase/plan). */
export class NotImplementedError extends Error {
  constructor(message = 'This operation is available in a later phase') {
    super(message);
    this.name = 'NotImplementedError';
  }
}

/**
 * Static/desktop build: the tab serving the shared database closed while a write
 * was on its way (#1009), usually a reload of another tab, so the write may or may
 * not have been kept. Reads are retried instead of throwing this.
 */
export class DatabaseInterruptedError extends Error {
  constructor(message = 'The local database changed hands before this change finished; it may not have been saved') {
    super(message);
    this.name = 'DatabaseInterruptedError';
  }
}

/**
 * The server failed (HTTP 5xx) and named the failure with a short id that is
 * also on its log line (#8). The UI shows the id so a reported failure can be
 * found in the server log.
 */
export class ServerError extends Error {
  readonly errorId: string;

  constructor(message: string, errorId: string) {
    super(message);
    this.name = 'ServerError';
    this.errorId = errorId;
  }
}
