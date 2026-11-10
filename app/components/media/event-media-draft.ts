import { AccessError, MediaTagConflictError, MediaUploadIntentConflictError, NotFoundError, RateLimitError, StorageLimitError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import type { MediaClient } from '@/lib/data/types';

export type EventMediaDraftItem =
  | { key: string; kind: 'existing'; mediaId: number }
  | { key: string; kind: 'file'; file: File; uploadIntentId: string };

export interface EventMediaDraftFailure {
  key: string;
  code: string;
  retryable: boolean;
}

export interface EventMediaDraftOutcome {
  succeededKeys: string[];
  failed: EventMediaDraftFailure[];
}

export interface EventMediaDraftError {
  code: string;
  retryable: boolean;
}

/** Convert client/service failures to a small, translated, privacy-safe contract. */
export function normalizeEventMediaDraftError(error: unknown): EventMediaDraftError {
  const candidate = error as { code?: unknown; name?: unknown } | null;
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  if (code === 'upload_intent_conflict') return { code, retryable: false };
  if (error instanceof MediaUploadIntentConflictError) return { code: 'upload_intent_conflict', retryable: false };
  if (error instanceof MediaTagConflictError) return { code: 'already_attached', retryable: false };
  if (error instanceof AccessError || candidate?.name === 'AccessError') return { code: 'permission', retryable: false };
  if (error instanceof NotFoundError || candidate?.name === 'NotFoundError') return { code: 'not_found', retryable: false };
  if (error instanceof ValidationError || candidate?.name === 'ValidationError') return { code: 'invalid', retryable: false };
  if (error instanceof StorageLimitError || candidate?.name === 'StorageLimitError') return { code: 'storage_full', retryable: true };
  if (error instanceof RateLimitError || candidate?.name === 'RateLimitError') return { code: 'rate_limited', retryable: true };
  if (error instanceof TypeError && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { code: 'offline', retryable: true };
  }
  return { code: 'generic', retryable: true };
}

/**
 * Best-effort attachment processing. Each item is attempted independently, so a
 * bad row cannot prevent the rest of a saved event's draft from completing.
 */
export async function processEventMediaDraft({
  eventId,
  treeId,
  items,
  client,
  galleryPersonId,
}: {
  eventId: number;
  treeId: number | null;
  items: readonly EventMediaDraftItem[];
  /** A person's life event: new uploads also go in their gallery (#1204). */
  galleryPersonId?: number;
  client: Pick<MediaClient, 'linkToOwner' | 'upload'>;
}): Promise<EventMediaDraftOutcome> {
  const succeededKeys: string[] = [];
  const failed: EventMediaDraftFailure[] = [];

  for (const item of items) {
    try {
      if (item.kind === 'existing') {
        await client.linkToOwner(item.mediaId, 'Events', eventId, treeId);
      } else {
        await client.upload({
          file: item.file,
          ownerTable: 'Events',
          ownerRecordId: eventId,
          personId: galleryPersonId,
          uploadIntentId: item.uploadIntentId,
        }, treeId);
      }
      succeededKeys.push(item.key);
    } catch (error) {
      const normalized = normalizeEventMediaDraftError(error);
      failed.push({ key: item.key, ...normalized });
    }
  }

  return { succeededKeys, failed };
}
