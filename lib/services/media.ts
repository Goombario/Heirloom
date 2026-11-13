import { resolveTreeScope, type TreeScope } from '@/lib/db/queries/trees';
import { AccessError, MediaTagConflictError, NotFoundError, PrimaryMediaConflictError } from '@/lib/data/errors';
import { validateDateField, ValidationError } from '@/lib/validation';
import { isPdfMedia } from '@/lib/media/allowed-extensions';
import {
  getAllMedia, getAllMediaWithPerson, getMediaByPersonId,
  getMediaById, lockMediaForDelete, insertMediaRow, updateMediaRow, deleteMediaRow, MEDIA_MUTABLE_FIELDS,
} from '@/lib/db/queries/media';
import {
  getMediaForPerson, getTagsForMedia, addMediaTag, clampPercent,
  deleteMediaTagRow, getMediaTagMutationSnapshot, lockMediaTagForMutation,
  tagSetPersonPrimary, updateMediaTagRow, MEDIA_TAG_MUTABLE_FIELDS, type MediaTagUpdate,
} from '@/lib/db/queries/media-tags';
import {
  clearFamilyPhotoLinks,
  getFamilyPhotoLink,
  lockFamilyForMediaMutation,
  setFamilyPhotoLink,
  clearPrimaryMediaLinksForPerson,
  getLowestMediaLinkForPerson,
  getPrimaryMediaLinkForPerson,
  lockPeopleForMediaMutation,
  setPrimaryMediaLink,
  upsertMediaLink,
  type DbExecutor,
} from '@/lib/db/queries/media-links';
import {
  auditCreate,
  auditCanonicalPrimaryChange,
  auditDelete,
  auditFamilyPhotoChange,
  auditUpdate,
  withAuditIds,
  type Audited,
} from '@/lib/db/queries/audit-capture';
import type { Media, MediaTag, MediaTagWithPerson, NewMedia, NewMediaTag } from '@/lib/db/schema';
import type { MediaOwnerFact, MediaOwnerTable } from '@/lib/db/fact-tables';
import { getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import { cleanupMediaFiles } from '@/lib/media-thumbnail';

interface Ctx { requestedTreeId: number | null; requestedOwnerId: number | null; currentUserId: number; }

const MAX_MEDIA_DELETE_BATCH = 100;

type MediaDeleteItemResult =
  | { id: number; status: 'deleted'; cleanupWarning: 'storage_cleanup_failed' | null }
  | { id: number; status: 'skipped'; code: 'not_found'; retryable: false }
  | { id: number; status: 'failed'; code: 'delete_failed'; retryable: true };

export interface MediaDeleteBatchResult {
  results: MediaDeleteItemResult[];
  deletedCount: number;
  skippedCount: number;
  failedCount: number;
  cleanupWarningCount: number;
}

// resolveTreeScope already throws AccessError directly — no re-wrap needed
// (unlike the old validateTreeAccess, which threw a plain Error).
function resolveOwner(ctx: Ctx): Promise<TreeScope> {
  return resolveTreeScope({ treeId: ctx.requestedTreeId, ownerId: ctx.requestedOwnerId }, ctx.currentUserId);
}

export interface PrimaryMediaParams {
  mediaId: number;
  personId: number;
  treeId: number;
  actingUserId: number;
}

export interface ClearPrimaryMediaParams {
  personId: number;
  treeId: number;
  actingUserId: number;
  /** Clear only while this photo is still the portrait, so a stale request can't drop a newer one. */
  onlyMediaId?: number;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === '23505';
}

async function lockRequiredPeople(
  personIds: number[],
  treeId: number,
  client: Parameters<typeof lockPeopleForMediaMutation>[2],
  notFoundMessage = 'Person not found',
): Promise<void> {
  const expected = [...new Set(personIds)];
  const locked = await lockPeopleForMediaMutation(expected, treeId, client);
  if (locked.length !== expected.length) throw new NotFoundError(notFoundMessage);
}

export interface CreateCanonicalMediaParams {
  data: NewMedia;
  links?: Array<{ ownerTable: MediaOwnerTable; ownerId: number; ownerFact?: MediaOwnerFact | null }>;
  tags?: Array<Omit<NewMediaTag, 'MediaId'>>;
  primaryPersonId?: number;
  actingUserId: number;
}

export async function setPrimaryMediaService(
  ctx: Ctx & { mediaId: number; personId: number },
): Promise<Audited> {
  const scope = await resolveOwner(ctx);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }
  return setPrimaryMediaForPerson({
    mediaId: ctx.mediaId,
    personId: ctx.personId,
    treeId: scope.treeId,
    actingUserId: ctx.currentUserId,
  });
}

/** Stop using this photo as the person's portrait (#1051). The photo stays linked to them. */
export async function clearPrimaryMediaService(
  ctx: Ctx & { mediaId: number; personId: number },
): Promise<Audited> {
  const scope = await resolveOwner(ctx);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }
  return clearPrimaryMediaForPerson({
    personId: ctx.personId,
    treeId: scope.treeId,
    actingUserId: ctx.currentUserId,
    onlyMediaId: ctx.mediaId,
  });
}

/**
 * Use this photo as the family's photo (#119, ADR 0047). Like a portrait it is a
 * record-level link marked primary, so a photo shown on the family only through its
 * members' tags gains a link to the family first.
 */
export async function setFamilyPhotoService(
  ctx: Ctx & { mediaId: number; familyId: number },
): Promise<Audited> {
  const scope = await resolveOwner(ctx);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!await lockFamilyForMediaMutation(ctx.familyId, scope.treeId, client)) {
      throw new NotFoundError('Family not found');
    }
    const selected = await getMediaById(ctx.mediaId, scope.treeId, client);
    if (!selected) throw new NotFoundError('Media not found');
    if (isPdfMedia(selected)) throw new ValidationError('A document cannot be a family photo');
    const oldMediaId = await getFamilyPhotoLink(ctx.familyId, scope.treeId, client);
    await upsertMediaLink({ mediaId: ctx.mediaId, ownerTable: 'Families', ownerId: ctx.familyId }, client);
    await clearFamilyPhotoLinks(ctx.familyId, client);
    await setFamilyPhotoLink(ctx.mediaId, ctx.familyId, client);
    const auditId = await auditFamilyPhotoChange({
      familyId: ctx.familyId,
      oldMediaId,
      newMediaId: ctx.mediaId,
      treeOwnerId: selected.UserId,
      userId: ctx.currentUserId,
      treeId: scope.treeId,
      exec: client,
    });
    await client.query('COMMIT');
    return withAuditIds({}, [auditId]);
  } catch (error) {
    await safeRollback(client);
    if (isUniqueViolation(error)) throw new PrimaryMediaConflictError();
    throw error;
  } finally {
    client.release();
  }
}

/** Stop using this photo as the family's photo; it stays linked to the family. */
export async function clearFamilyPhotoService(
  ctx: Ctx & { mediaId: number; familyId: number },
): Promise<Audited> {
  const scope = await resolveOwner(ctx);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!await lockFamilyForMediaMutation(ctx.familyId, scope.treeId, client)) {
      throw new NotFoundError('Family not found');
    }
    const oldMediaId = await getFamilyPhotoLink(ctx.familyId, scope.treeId, client);
    // A stale request (another photo was chosen since) changes nothing.
    if (oldMediaId !== ctx.mediaId) {
      await client.query('COMMIT');
      return withAuditIds({}, []);
    }
    const oldMedia = await getMediaById(oldMediaId, scope.treeId, client);
    await clearFamilyPhotoLinks(ctx.familyId, client);
    const auditId = oldMedia ? await auditFamilyPhotoChange({
      familyId: ctx.familyId,
      oldMediaId,
      newMediaId: null,
      treeOwnerId: oldMedia.UserId,
      userId: ctx.currentUserId,
      treeId: scope.treeId,
      exec: client,
    }) : null;
    await client.query('COMMIT');
    return withAuditIds({}, [auditId]);
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
}

/** Orchestrate canonical creation on a caller-owned transaction executor. */
export async function createCanonicalMedia(
  params: CreateCanonicalMediaParams,
  exec: DbExecutor,
): Promise<Media> {
  const treeId = params.data.TreeId;
  if (treeId == null) throw new NotFoundError('Tree not found');

  const media = await insertMediaRow(params.data, exec);
  const links = [...(params.links ?? [])];
  if (params.primaryPersonId != null && !links.some(
    link => link.ownerTable === 'People' && link.ownerId === params.primaryPersonId && !link.ownerFact,
  )) {
    links.push({ ownerTable: 'People', ownerId: params.primaryPersonId });
  }
  for (const link of links) {
    await upsertMediaLink({ mediaId: media.Id, ...link }, exec);
  }
  for (const tag of params.tags ?? []) {
    await addMediaTag({ ...tag, MediaId: media.Id }, treeId, params.actingUserId, exec);
  }
  if (params.primaryPersonId != null) {
    await lockRequiredPeople([params.primaryPersonId], treeId, exec, 'Person not found');
    await clearPrimaryMediaLinksForPerson(params.primaryPersonId, exec);
    await setPrimaryMediaLink(media.Id, params.primaryPersonId, exec);
  }
  const created = await getMediaById(media.Id, treeId, exec);
  if (!created) throw new Error('Failed to create canonical media');
  await auditCreate(
    'media',
    created as unknown as Record<string, unknown>,
    created.UserId,
    params.actingUserId,
    exec,
  );
  return created;
}

/** Serialize all policy and persistence work on the target People row. */
export async function setPrimaryMediaForPerson(params: PrimaryMediaParams): Promise<Audited> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await lockRequiredPeople([params.personId], params.treeId, client);
    const selected = await getMediaById(params.mediaId, params.treeId, client);
    if (!selected) throw new NotFoundError('Media not found');
    // A portrait is a photo; a PDF document (#510) can't be one.
    if (isPdfMedia(selected)) throw new ValidationError('A document cannot be a portrait');
    const oldMediaId = await getPrimaryMediaLinkForPerson(params.personId, params.treeId, client);

    await upsertMediaLink({ mediaId: params.mediaId, ownerTable: 'People', ownerId: params.personId }, client);
    await clearPrimaryMediaLinksForPerson(params.personId, client);
    await setPrimaryMediaLink(params.mediaId, params.personId, client);
    const auditId = await auditCanonicalPrimaryChange({
      personId: params.personId,
      oldMediaId,
      newMediaId: params.mediaId,
      treeOwnerId: selected.UserId,
      userId: params.actingUserId,
      treeId: params.treeId,
      exec: client,
    });
    await client.query('COMMIT');
    return withAuditIds({}, [auditId]);
  } catch (error) {
    await safeRollback(client);
    if (isUniqueViolation(error)) throw new PrimaryMediaConflictError();
    throw error;
  } finally {
    client.release();
  }
}

export async function clearPrimaryMediaForPerson(params: ClearPrimaryMediaParams): Promise<Audited> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await lockRequiredPeople([params.personId], params.treeId, client);
    const oldMediaId = await getPrimaryMediaLinkForPerson(params.personId, params.treeId, client);
    if (params.onlyMediaId != null && oldMediaId !== params.onlyMediaId) {
      await client.query('COMMIT');
      return withAuditIds({}, []);
    }
    const oldMedia = oldMediaId == null ? null : await getMediaById(oldMediaId, params.treeId, client);
    await clearPrimaryMediaLinksForPerson(params.personId, client);
    let auditId: number | null = null;
    if (oldMedia) {
      auditId = await auditCanonicalPrimaryChange({
        personId: params.personId,
        oldMediaId,
        newMediaId: null,
        treeOwnerId: oldMedia.UserId,
        userId: params.actingUserId,
        treeId: params.treeId,
        exec: client,
      });
    }
    await client.query('COMMIT');
    return withAuditIds({}, [auditId]);
  } catch (error) {
    await safeRollback(client);
    if (isUniqueViolation(error)) throw new PrimaryMediaConflictError();
    throw error;
  } finally {
    client.release();
  }
}

export async function removeMediaTagCanonical(params: {
  tagId: number;
  mediaId: number;
  treeId: number;
  actingUserId: number;
}): Promise<boolean> {
  const client = await getClient();
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await client.query('BEGIN');
      const snapshot = await getMediaTagMutationSnapshot(params.tagId, params.mediaId, params.treeId, client);
      if (!snapshot) {
        await client.query('COMMIT');
        return false;
      }
      await lockRequiredPeople([snapshot.PersonId], params.treeId, client);
      const before = await lockMediaTagForMutation(
        params.tagId, params.mediaId, params.treeId, snapshot.PersonId, client,
      );
      if (!before) {
        await safeRollback(client);
        continue;
      }
      const oldMediaId = await getPrimaryMediaLinkForPerson(before.PersonId, params.treeId, client);
      const wasPrimary = oldMediaId === params.mediaId;
      if (wasPrimary) await clearPrimaryMediaLinksForPerson(before.PersonId, client);
      if (!await deleteMediaTagRow(params.tagId, params.mediaId, client)) {
        throw new NotFoundError('Tag not found');
      }
      let fallback: number | null = null;
      // A primary this tag set (#922) goes back to none, as before the tag.
      if (wasPrimary && !await tagSetPersonPrimary(params.tagId, before.PersonId, params.treeId, client)) {
        fallback = await getLowestMediaLinkForPerson(before.PersonId, params.treeId, null, client);
        if (fallback != null) await setPrimaryMediaLink(fallback, before.PersonId, client);
      }
      if (wasPrimary) {
        await auditCanonicalPrimaryChange({
          personId: before.PersonId,
          oldMediaId: params.mediaId,
          newMediaId: fallback,
          treeOwnerId: before.MediaOwnerId,
          userId: params.actingUserId,
          treeId: params.treeId,
          exec: client,
        });
      }
      await auditDelete(
        'mediatag',
        before as unknown as Record<string, unknown>,
        before.MediaOwnerId,
        params.actingUserId,
        client,
      );
      await client.query('COMMIT');
      return true;
    }
    throw new Error('Tag changed during deletion; retry the operation');
  } catch (error) {
    await safeRollback(client);
    if (isUniqueViolation(error)) throw new PrimaryMediaConflictError();
    throw error;
  } finally {
    client.release();
  }
}

/** Reassign or edit a tag under the same People-before-MediaTag lock order. */
async function updateMediaTagCanonical(params: {
  tagId: number;
  mediaId: number;
  data: MediaTagUpdate;
  treeId: number;
  actingUserId: number;
}): Promise<Audited<MediaTagWithPerson> | null> {
  const normalizedData: MediaTagUpdate = { ...params.data };
  for (const field of ['RegionX', 'RegionY', 'RegionW', 'RegionH'] as const) {
    if (normalizedData[field] !== undefined) {
      const raw = Number(normalizedData[field]);
      if (!Number.isFinite(raw)
        || ((field === 'RegionW' || field === 'RegionH') && !(raw > 0))) {
        throw new ValidationError('Face region must have valid coordinates and positive dimensions');
      }
      normalizedData[field] = clampPercent(raw);
    }
  }
  if (
    (normalizedData.RegionX !== undefined && !Number.isFinite(normalizedData.RegionX))
    || (normalizedData.RegionY !== undefined && !Number.isFinite(normalizedData.RegionY))
    || (normalizedData.RegionW !== undefined && !(normalizedData.RegionW > 0))
    || (normalizedData.RegionH !== undefined && !(normalizedData.RegionH > 0))
  ) {
    throw new ValidationError('Face region must have valid coordinates and positive dimensions');
  }
  const client = await getClient();
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await client.query('BEGIN');
      const snapshot = await getMediaTagMutationSnapshot(params.tagId, params.mediaId, params.treeId, client);
      if (!snapshot) {
        await client.query('COMMIT');
        return null;
      }
      const personIds = [snapshot.PersonId];
      if (normalizedData.PersonId !== undefined) personIds.push(normalizedData.PersonId);
      await lockRequiredPeople(personIds, params.treeId, client, 'Person not found in this tree');
      const before = await lockMediaTagForMutation(
        params.tagId, params.mediaId, params.treeId, snapshot.PersonId, client,
      );
      if (!before) {
        await safeRollback(client);
        continue;
      }
      let updated;
      try {
        updated = await updateMediaTagRow(
          params.tagId, params.mediaId, normalizedData, params.treeId, client,
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new MediaTagConflictError();
        throw error;
      }
      if (!updated) throw new NotFoundError('Tag not found');
      if (normalizedData.PersonId !== undefined) {
        await upsertMediaLink({
          mediaId: params.mediaId,
          ownerTable: 'People',
          ownerId: normalizedData.PersonId,
        }, client);
      }
      const after = (await getTagsForMedia(params.mediaId, params.treeId, client))
        .find(tag => tag.Id === params.tagId) ?? null;
      if (!after) throw new NotFoundError('Tag not found');
      // MediaTag has no TreeId column: stamp the tree so the entry is tree-scoped
      // and revertable at once, like a tag create's (#1044).
      const auditId = await auditUpdate(
        'mediatag',
        { ...before, TreeId: params.treeId } as unknown as Record<string, unknown>,
        { ...after, TreeId: params.treeId } as unknown as Record<string, unknown>,
        MEDIA_TAG_MUTABLE_FIELDS,
        before.MediaOwnerId,
        params.actingUserId,
        client,
      );
      await client.query('COMMIT');
      return withAuditIds(after, [auditId]);
    }
    throw new Error('Tag changed during update; retry the operation');
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function listMediaService(
  ctx: Ctx & { personId?: number; withPerson?: boolean; includeTagged?: boolean },
): Promise<Media[]> {
  const scope = await resolveOwner(ctx);
  if (ctx.personId != null) {
    return ctx.includeTagged
      ? await getMediaForPerson(ctx.personId, scope.treeId)
      : await getMediaByPersonId(ctx.personId, scope.treeId);
  }
  if (ctx.withPerson) return getAllMediaWithPerson(scope.treeId);
  return getAllMedia(scope.treeId);
}

export async function updateMediaService(
  ctx: Ctx & { id: number; body: Record<string, unknown> },
): Promise<Audited<Media> | null> {
  const scope = await resolveOwner(ctx);
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');
  const { id, body } = ctx;

  const updateData: Partial<NewMedia> = {};
  if (body.Title !== undefined) updateData.Title = body.Title as string | null;
  if (body.Date !== undefined) updateData.Date = validateDateField(body.Date, 'Date', 100);
  // FilePath is deliberately NOT writable via the API: the only legitimate
  // writer is the upload route (direct SQL); a client-supplied value would be
  // a path-traversal vector into the export-zip and delete-cleanup sinks.
  if (body.Format !== undefined) updateData.Format = body.Format as string | null;
  if (body.ContentType !== undefined) updateData.ContentType = body.ContentType as string | null;
  if (body.FocalX !== undefined) updateData.FocalX = Math.max(0, Math.min(100, Number(body.FocalX)));
  if (body.FocalY !== undefined) updateData.FocalY = Math.max(0, Math.min(100, Number(body.FocalY)));
  if (body.FocalRadius !== undefined) updateData.FocalRadius = body.FocalRadius === null ? null : Math.max(0, Math.min(500, Number(body.FocalRadius)));

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const before = await getMediaById(id, scope.treeId, client);
    if (!before) {
      await client.query('COMMIT');
      return null;
    }
    if (Object.keys(updateData).length > 0) {
      const updated = await updateMediaRow(id, updateData, scope.treeId, client);
      if (!updated) throw new NotFoundError('Media not found');
    }
    const after = await getMediaById(id, scope.treeId, client);
    if (!after) throw new NotFoundError('Media not found');
    const auditId = await auditUpdate(
      'media',
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      MEDIA_MUTABLE_FIELDS,
      before.UserId,
      ctx.currentUserId,
      client,
    );
    await client.query('COMMIT');
    return withAuditIds(after, [auditId]);
  } catch (error) {
    await safeRollback(client);
    if (isUniqueViolation(error)) throw new PrimaryMediaConflictError();
    throw error;
  } finally {
    client.release();
  }
}

export async function listTagsService(ctx: Ctx & { mediaId: number }): Promise<MediaTagWithPerson[]> {
  const scope = await resolveOwner(ctx);
  return getTagsForMedia(ctx.mediaId, scope.treeId);
}

/** Remove a tag and repair canonical primary state on a caller-owned transaction. */
export async function removeMediaTagCanonicalInTransaction(params: {
  tagId: number;
  mediaId: number;
  treeId: number;
  actingUserId: number;
}, client: DbExecutor): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await getMediaTagMutationSnapshot(params.tagId, params.mediaId, params.treeId, client);
    if (!snapshot) return false;
    await lockRequiredPeople([snapshot.PersonId], params.treeId, client);
    const before = await lockMediaTagForMutation(
      params.tagId, params.mediaId, params.treeId, snapshot.PersonId, client,
    );
    if (!before) continue;
    const oldMediaId = await getPrimaryMediaLinkForPerson(before.PersonId, params.treeId, client);
    const wasPrimary = oldMediaId === params.mediaId;
    if (wasPrimary) await clearPrimaryMediaLinksForPerson(before.PersonId, client);
    if (!await deleteMediaTagRow(params.tagId, params.mediaId, client)) {
      throw new NotFoundError('Tag not found');
    }
    let fallback: number | null = null;
    // A primary this tag set (#922) goes back to none, as before the tag.
    if (wasPrimary && !await tagSetPersonPrimary(params.tagId, before.PersonId, params.treeId, client)) {
      fallback = await getLowestMediaLinkForPerson(before.PersonId, params.treeId, null, client);
      if (fallback != null) await setPrimaryMediaLink(fallback, before.PersonId, client);
    }
    if (wasPrimary) {
      await auditCanonicalPrimaryChange({
        personId: before.PersonId,
        oldMediaId: params.mediaId,
        newMediaId: fallback,
        treeOwnerId: before.MediaOwnerId,
        userId: params.actingUserId,
        treeId: params.treeId,
        exec: client,
      });
    }
    await auditDelete(
      'mediatag',
      before as unknown as Record<string, unknown>,
      before.MediaOwnerId,
      params.actingUserId,
      client,
    );
    return true;
  }
  throw new Error('Tag changed during deletion; retry the operation');
}

export async function updateTagService(
  ctx: Ctx & { mediaId: number; tagId: number; body: Record<string, unknown> },
): Promise<Audited<MediaTagWithPerson>> {
  const scope = await resolveOwner(ctx);
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');
  const data: MediaTagUpdate = {};
  if (ctx.body.PersonId !== undefined) {
    const personId = parseInt(String(ctx.body.PersonId), 10);
    if (isNaN(personId)) throw new ValidationError('Invalid PersonId');
    data.PersonId = personId;
  }
  for (const field of ['RegionX', 'RegionY', 'RegionW', 'RegionH'] as const) {
    if (ctx.body[field] === undefined) continue;
    const raw = Number(ctx.body[field]);
    if (!Number.isFinite(raw)
      || ((field === 'RegionW' || field === 'RegionH') && !(raw > 0))) {
      throw new ValidationError('Face region must have valid coordinates and positive dimensions');
    }
    data[field] = clampPercent(raw);
  }
  if (Object.keys(data).length === 0) throw new ValidationError('No valid fields provided');
  const tag = await updateMediaTagCanonical({
    tagId: ctx.tagId,
    mediaId: ctx.mediaId,
    data,
    treeId: scope.treeId,
    actingUserId: ctx.currentUserId,
  });
  if (!tag) throw new NotFoundError('Tag not found');
  return tag;
}

export async function createTagService(
  ctx: Ctx & { mediaId: number; body: Record<string, unknown> },
): Promise<Audited<MediaTag>> {
  const scope = await resolveOwner(ctx);
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');
  const personId = parseInt(String(ctx.body.PersonId), 10);
  if (isNaN(personId)) throw new ValidationError('A valid PersonId is required');
  const rawRegion = {
    RegionX: Number(ctx.body.RegionX), RegionY: Number(ctx.body.RegionY),
    RegionW: Number(ctx.body.RegionW), RegionH: Number(ctx.body.RegionH),
  };
  if (!Object.values(rawRegion).every(Number.isFinite) || !(rawRegion.RegionW > 0) || !(rawRegion.RegionH > 0)) {
    throw new ValidationError('Face region must have valid coordinates and positive dimensions');
  }
  const regionX = clampPercent(rawRegion.RegionX);
  const regionY = clampPercent(rawRegion.RegionY);
  const regionW = clampPercent(rawRegion.RegionW);
  const regionH = clampPercent(rawRegion.RegionH);
  if (!Number.isFinite(regionX) || !Number.isFinite(regionY) || !(regionW > 0) || !(regionH > 0)) {
    throw new ValidationError('Face region must have valid coordinates and positive dimensions');
  }
  const data: NewMediaTag = {
    MediaId: ctx.mediaId, PersonId: personId,
    RegionX: regionX, RegionY: regionY,
    RegionW: regionW, RegionH: regionH,
  };
  const client = await getClient();
  let created: Audited<MediaTagWithPerson>;
  try {
    await client.query('BEGIN');
    // A face region belongs on a photo; a PDF document (#510) is linked instead.
    if (isPdfMedia(await getMediaById(ctx.mediaId, scope.treeId, client))) {
      throw new ValidationError('A document has no faces to tag');
    }
    created = await addTagSettingFirstPrimary(data, scope.treeId, ctx.currentUserId, client);
    await client.query('COMMIT');
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }

  return created;
}

/**
 * Tag a face, and when the person has no profile picture yet, make this photo it
 * (#922). Their avatar crops to the tag region (`primaryPhotoJoin`), so a group
 * photo still frames their own face. Never replaces an existing primary. Runs on
 * the caller's transaction and locks the People row, like every primary change.
 */
export async function addTagSettingFirstPrimary(
  data: NewMediaTag,
  treeId: number,
  actingUserId: number,
  client: DbExecutor,
): Promise<Audited<MediaTagWithPerson>> {
  await lockRequiredPeople([data.PersonId], treeId, client, 'Media or person not found in this tree');
  const setPrimary = await getPrimaryMediaLinkForPerson(data.PersonId, treeId, client) == null;
  const created = await addMediaTag(data, treeId, actingUserId, client, { setPrimary });
  // A first tag that also becomes the profile picture is two entries; Undo reverts both.
  const auditIds = [...created.auditIds];
  if (setPrimary) {
    const media = await getMediaById(data.MediaId, treeId, client);
    if (media) {
      const primaryAuditId = await auditCanonicalPrimaryChange({
        personId: data.PersonId,
        oldMediaId: null,
        newMediaId: data.MediaId,
        treeOwnerId: media.UserId,
        userId: actingUserId,
        treeId,
        exec: client,
      });
      if (primaryAuditId != null) auditIds.push(primaryAuditId);
    }
  }
  return { ...created, auditIds };
}

export async function removeTagService(ctx: Ctx & { mediaId: number; tagId: number }): Promise<void> {
  const scope = await resolveOwner(ctx);
  // Deletes need owner/edit ('contribute' blocks deletes, same as top-level entities).
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }
  const ok = await removeMediaTagCanonical({
    tagId: ctx.tagId,
    mediaId: ctx.mediaId,
    treeId: scope.treeId,
    actingUserId: ctx.currentUserId,
  });
  if (!ok) throw new NotFoundError('Tag not found');
}

function validateMediaDeleteIds(ids: unknown): number[] {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError('Media ids must be a non-empty array');
  }
  if (ids.length > MAX_MEDIA_DELETE_BATCH) {
    throw new ValidationError(`Cannot delete more than ${MAX_MEDIA_DELETE_BATCH} media items at once`);
  }

  const seen = new Set<number>();
  for (const id of ids) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      throw new ValidationError('Media ids must be positive integers');
    }
    if (seen.has(id)) throw new ValidationError('Media ids must not contain duplicates');
    seen.add(id);
  }
  return ids;
}

/** One independent transaction for one media row; cleanup happens after commit. */
async function deleteMediaItem(
  id: number,
  scope: TreeScope,
  actingUserId: number,
): Promise<MediaDeleteItemResult> {
  let client: Awaited<ReturnType<typeof getClient>> | null = null;
  let committed: Media | null = null;
  try {
    client = await getClient();
    await client.query('BEGIN');
    const media = await lockMediaForDelete(id, scope.treeId, client);
    if (!media) {
      await client.query('COMMIT');
      return { id, status: 'skipped', code: 'not_found', retryable: false };
    }

    await auditDelete(
      'media',
      media as unknown as Record<string, unknown>,
      media.UserId,
      actingUserId,
      client,
    );
    if (!await deleteMediaRow(id, scope.treeId, client)) {
      throw new Error('Media row disappeared during deletion');
    }
    await client.query('COMMIT');
    committed = media;
  } catch {
    if (client) await safeRollback(client);
    return { id, status: 'failed', code: 'delete_failed', retryable: true };
  } finally {
    client?.release();
  }

  let cleanupWarning: 'storage_cleanup_failed' | null = null;
  if (committed?.FilePath) {
    try {
      cleanupWarning = await cleanupMediaFiles(scope.ownerId, committed.FilePath);
    } catch (error) {
      // Cleanup is deliberately best-effort. Preserve the committed deletion
      // while surfacing a stable warning instead of a filesystem error.
      console.error('Failed to clean up media files:', error);
      cleanupWarning = 'storage_cleanup_failed';
    }
  }
  return { id, status: 'deleted', cleanupWarning };
}

export async function deleteMediaBatchService(
  ctx: Ctx & { ids: unknown },
): Promise<MediaDeleteBatchResult> {
  const ids = validateMediaDeleteIds(ctx.ids);
  const scope = await resolveOwner(ctx);
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }

  const results: MediaDeleteItemResult[] = [];
  for (const id of ids) {
    results.push(await deleteMediaItem(id, scope, ctx.currentUserId));
  }
  return {
    results,
    deletedCount: results.filter((result) => result.status === 'deleted').length,
    skippedCount: results.filter((result) => result.status === 'skipped').length,
    failedCount: results.filter((result) => result.status === 'failed').length,
    cleanupWarningCount: results.filter(
      (result) => result.status === 'deleted' && result.cleanupWarning !== null,
    ).length,
  };
}

export async function deleteMediaService(ctx: Ctx & { id: number }): Promise<boolean> {
  const result = await deleteMediaBatchService({ ...ctx, ids: [ctx.id] });
  const item = result.results[0];
  if (item.status === 'skipped') return false;
  if (item.status === 'failed') throw new Error('Failed to delete media');
  return true;
}
