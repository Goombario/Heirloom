import { AccessError, FileTooLargeError, MediaTagConflictError, MediaUploadIntentConflictError, NotFoundError, PrimaryMediaConflictError, RateLimitError, ServerError, StorageLimitError, UnauthorizedError, type StorageLimitMetadata } from '../errors';
import { ValidationError } from '@/lib/validation';
import type { Audited } from '../types';

/** Reads `{ error }` from a failed response and throws the matching typed error. */
export async function throwForStatus(res: Response): Promise<never> {
  let message = `HTTP ${res.status}`;
  let code: string | undefined;
  let retryable = false;
  let retryAfterSeconds: number | undefined;
  let storageMetadata: StorageLimitMetadata | undefined;
  let errorId: string | undefined;
  try {
    const data = await res.json();
    if (data && typeof data.error === 'string') message = data.error;
    if (data && typeof data.code === 'string') code = data.code;
    if (data && typeof data.errorId === 'string' && /^[\w-]{1,40}$/.test(data.errorId)) errorId = data.errorId;
    if (data && data.retryable === true) retryable = true;
    if (data && typeof data.retryAfterSeconds === 'number' && Number.isFinite(data.retryAfterSeconds)) retryAfterSeconds = data.retryAfterSeconds;
    if (data && typeof data === 'object') {
      const candidate = data as Record<string, unknown>;
      const metadata: StorageLimitMetadata = {};
      if (typeof candidate.usedBytes === 'number' && Number.isFinite(candidate.usedBytes)) metadata.usedBytes = candidate.usedBytes;
      if (typeof candidate.limitBytes === 'number' && Number.isFinite(candidate.limitBytes)) metadata.limitBytes = candidate.limitBytes;
      if (typeof candidate.remainingBytes === 'number' && Number.isFinite(candidate.remainingBytes)) metadata.remainingBytes = candidate.remainingBytes;
      if (Object.keys(metadata).length > 0) storageMetadata = metadata;
    }
  } catch {
    // non-JSON body; keep the default message
  }
  switch (res.status) {
    case 401:
      throw new UnauthorizedError(message);
    case 403:
      throw new AccessError(message);
    case 404:
      throw new NotFoundError(message);
    case 409:
      if (code === 'primary_conflict' && retryable) throw new PrimaryMediaConflictError(message);
      if (code === 'media_tag_conflict' && !retryable) throw new MediaTagConflictError(message);
      if (code === 'upload_intent_conflict' && !retryable) throw new MediaUploadIntentConflictError(message);
      throw new Error(message);
    case 400:
      throw new ValidationError(message);
    case 413:
      throw new FileTooLargeError(message, storageMetadata?.limitBytes);
    case 429:
      throw new RateLimitError(message, retryAfterSeconds);
    case 507:
      throw new StorageLimitError(message, storageMetadata);
    default:
      // A server failure's id (#8) lets a reported error be matched to its
      // line in the server log.
      if (errorId && res.status >= 500) throw new ServerError(message, errorId);
      throw new Error(message);
  }
}

/** Builds a `?treeId=N` (or empty) query string. */
export function treeQuery(treeId?: number | null): string {
  return treeId != null ? `?treeId=${treeId}` : '';
}

/**
 * The audit ids a write response carries (#1044), for Undo. A body-less 204 or a
 * body without them (an older server) yields none, so the UI simply offers no Undo.
 */
export async function auditIdsFrom(res: Response): Promise<Audited> {
  if (res.status === 204) return { auditIds: [] };
  const body = (await res.json().catch(() => null)) as { auditIds?: unknown } | null;
  return { auditIds: Array.isArray(body?.auditIds) ? body.auditIds.filter((id): id is number => typeof id === 'number') : [] };
}

/** A written record from a response, with `auditIds` defaulted to none when the server sent none. */
export function ensureAuditIds<T extends object>(record: T & { auditIds?: unknown }): Audited<T> {
  const ids = Array.isArray(record.auditIds) ? record.auditIds.filter((id): id is number => typeof id === 'number') : [];
  return { ...record, auditIds: ids };
}
