import type { DbExecutor } from '@/lib/db/init-schema';
import type { Media } from '@/lib/db/schema';
import { MediaUploadIntentConflictError } from '@/lib/data/errors';
import type { ValidatedMediaUploadTargets } from '@/lib/services/media-upload-targets';

/** Stable, field-ordered representation of the request's canonical targets. */
export function serializeUploadIntentTarget(targets: ValidatedMediaUploadTargets): string {
  return JSON.stringify({
    caseId: targets.caseId,
    // A record-level owner keeps the snapshot it had before facts (ADR 0030).
    owner: targets.owner === null ? null : {
      id: targets.owner.id,
      table: targets.owner.table,
      ...(targets.owner.fact ? { fact: targets.owner.fact } : {}),
    },
    personId: targets.personId,
  });
}

/** Compare a replay against immutable bytes and its validated canonical targets. */
export async function verifyUploadIntentIdentity(
  media: Media,
  targets: ValidatedMediaUploadTargets,
  contentHash: string,
  _exec?: DbExecutor,
): Promise<Media> {
  if (media.ContentHash !== contentHash) throw new MediaUploadIntentConflictError();

  // Intent rows carry an immutable snapshot. Missing snapshots fail closed
  // rather than being guessed from mutable owner links.
  if (media.UploadIntentTarget !== serializeUploadIntentTarget(targets)) {
    throw new MediaUploadIntentConflictError();
  }
  const { UploadIntentId: _uploadIntentId, UploadIntentTarget: _uploadIntentTarget, ...publicMedia } = media;
  return publicMedia;
}
