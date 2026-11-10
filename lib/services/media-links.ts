import { getMediaForOwner, getMediaGalleryForOwner, getMediaLinkOwners, linkMedia, unlinkMedia } from '@/lib/db/queries/media-links';
import { getMediaById } from '@/lib/db/queries/media';
import type { Media, MediaLinkOwner, OwnerGalleryMedia } from '@/lib/db/schema';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { query } from '@/lib/db/connection';
import { validatedOwner, assertOwnerInTree } from '@/lib/services/owner-links';
import { isMediaOwnerFactFor, isMediaOwnerTable, type MediaOwnerFact, type MediaOwnerTable } from '@/lib/db/fact-tables';
import { ValidationError } from '@/lib/validation';

function validatedMediaOwner(ownerTable: string, ownerId: number): MediaOwnerTable {
  const table = validatedOwner(ownerTable, ownerId);
  if (!isMediaOwnerTable(table)) {
    throw new ValidationError(`Invalid media ownerTable: ${ownerTable}`);
  }
  return table;
}

/** An optional fact from untrusted input, checked against its owner table (ADR 0030). */
function validatedOwnerFact(ownerTable: MediaOwnerTable, ownerFact: string | null | undefined): MediaOwnerFact | null {
  if (ownerFact == null || ownerFact === '') return null;
  if (!isMediaOwnerFactFor(ownerTable, ownerFact)) {
    throw new ValidationError(`Invalid ownerFact for ${ownerTable}: ${ownerFact}`);
  }
  return ownerFact;
}

export interface ListMediaForOwnerParams {
  /** ENTITY link args (rule 1) — the family/source/… record media is attached to. Not a tree scope. */
  ownerTable: string;
  ownerId: number;
  /** The owner's vital fact, for a fact panel; absent for the record itself. */
  ownerFact?: string | null;
  /** TREE scope (legacy ?ownerId= deep-link compat) — resolved via resolveTreeScope. */
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** Validate access, then list media attached to one owner record (family/source/…). */
export async function listMediaForOwnerService(params: ListMediaForOwnerParams): Promise<Media[]> {
  const { ownerTable, ownerId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const table = validatedMediaOwner(ownerTable, ownerId);
  const fact = validatedOwnerFact(table, params.ownerFact);
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  return getMediaForOwner(table, ownerId, scope.treeId, fact);
}

/** Validate access, then list explicit and (for families) inferred gallery media. */
export async function listGalleryForOwnerService(params: ListMediaForOwnerParams): Promise<OwnerGalleryMedia[]> {
  const { ownerTable, ownerId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const table = validatedMediaOwner(ownerTable, ownerId);
  const fact = validatedOwnerFact(table, params.ownerFact);
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  await assertOwnerInTree(table, ownerId, scope.treeId);
  return getMediaGalleryForOwner(table, ownerId, scope.treeId, fact ?? undefined);
}

/** Validate access, then list every record one media row is linked to (#510). */
export async function listLinkOwnersForMediaService(params: {
  mediaId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}): Promise<MediaLinkOwner[]> {
  const scope = await resolveTreeScope({ treeId: params.requestedTreeId, ownerId: params.requestedOwnerId }, params.currentUserId);
  if (!await getMediaById(params.mediaId, scope.treeId)) throw new NotFoundError('Media not found');
  return getMediaLinkOwners(params.mediaId, scope.treeId);
}

export interface LinkMediaForOwnerParams {
  mediaId: number;
  /** ENTITY link args (rule 1) — the family/source/… record to attach media to. Not a tree scope. */
  ownerTable: string;
  ownerId: number;
  /** The owner's vital fact, for a fact panel; absent for the record itself. */
  ownerFact?: string | null;
  /** TREE scope (legacy ?ownerId= deep-link compat) — resolved via resolveTreeScope. */
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * Attach an existing media row to an owner record. Checks write permission, that
 * the owner record is in the tree (IDOR), and that the media belongs to the tree.
 */
export async function linkMediaForOwnerService(params: LinkMediaForOwnerParams): Promise<void> {
  const { mediaId, ownerTable, ownerId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const table = validatedMediaOwner(ownerTable, ownerId);
  const fact = validatedOwnerFact(table, params.ownerFact);

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  // assertOwnerInTree checks the entity row's own "TreeId" (row-to-row/IDOR
  // check) against the resolved tree scope.
  await assertOwnerInTree(table, ownerId, scope.treeId);
  const media = await query('SELECT 1 FROM "Media" WHERE "Id" = $1 AND "TreeId" = $2', [mediaId, scope.treeId]);
  if (media.rowCount === 0) throw new NotFoundError('Media not found in this tree');

  await linkMedia(mediaId, table, ownerId, fact);
}

export interface UnlinkMediaForOwnerParams {
  mediaId: number;
  /** ENTITY link args (rule 1) — the family/source/… record to detach media from. Not a tree scope. */
  ownerTable: string;
  ownerId: number;
  /** The owner's vital fact, for a fact panel; absent for the record itself. */
  ownerFact?: string | null;
  /** TREE scope (legacy ?ownerId= deep-link compat) — resolved via resolveTreeScope. */
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * Detach media from an owner. Any writer (contribute/edit/owner) may unlink; the
 * detach is unlink-only — the Media row persists in the library (#86). Explicit
 * deletion is a separate library action (deleteMediaService, owner/edit only).
 */
export async function unlinkMediaForOwnerService(params: UnlinkMediaForOwnerParams): Promise<void> {
  const { mediaId, ownerTable, ownerId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const table = validatedMediaOwner(ownerTable, ownerId);
  const fact = validatedOwnerFact(table, params.ownerFact);

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const removed = await unlinkMedia(mediaId, table, ownerId, scope.treeId, fact);
  if (!removed) throw new NotFoundError('Media link not found');
}
