import {
  getSources,
  getSourcesWithCitationCount,
  getSource,
  createSource,
  updateSource,
  deleteSource,
  isSourceType,
  searchSources,
  getRecentlyCitedSources,
  type Source,
  type SourceWithCitationCount,
} from '@/lib/db/queries/sources';
import { getCitedByForSource, type CitedByRow } from '@/lib/db/queries/citations';
import { syncSourceRepository } from '@/lib/db/queries/repositories';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { validateStringField, ValidationError } from '@/lib/validation';
import type { CreateSourceInput, UpdateSourceInput } from '@/lib/data/types';

export interface ListSourcesParams {
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
  withCounts?: boolean;
}

/** GET /api/sources logic: validate access, then list sources (with or without citation counts). */
export async function listSourcesService(
  params: ListSourcesParams
): Promise<{ sources: Source[] | SourceWithCitationCount[]; count: number }> {
  const { requestedTreeId, requestedOwnerId, currentUserId, withCounts } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);

  if (withCounts) {
    const sources = await getSourcesWithCitationCount(scope.treeId);
    return { sources, count: sources.length };
  }

  const sources = await getSources(scope.treeId);
  return { sources, count: sources.length };
}

export interface SearchSourcesParams {
  q: string;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/sources?q= logic: validate access, then search sources by query string. */
export async function searchSourcesService(
  params: SearchSourcesParams
): Promise<Source[]> {
  const { q, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  return searchSources(scope.treeId, q);
}

/** How many recently cited sources the Attach drawer lists before a search (#799). */
const RECENTLY_CITED_LIMIT = 5;

/** GET /api/sources?recent=true logic: the tree's most recently cited sources, newest first. */
export async function listRecentlyCitedSourcesService(params: {
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}): Promise<Source[]> {
  const { requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  return getRecentlyCitedSources(scope.treeId, RECENTLY_CITED_LIMIT);
}

export interface GetSourceParams {
  id: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/sources/[id] logic: validate access, then fetch a single source by id. */
export async function getSourceService(params: GetSourceParams): Promise<Source> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  const source = await getSource(id, scope.treeId);
  if (!source) throw new NotFoundError('Source not found');
  return source;
}

/** New Type values must come from the fixed vocabulary; null/absent falls back to the default. */
function validateSourceType(type: unknown): void {
  if (type !== undefined && type !== null && !isSourceType(type)) {
    throw new ValidationError(`Invalid source type: ${String(type)}`);
  }
}

export interface CreateSourceParams {
  input: CreateSourceInput;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** POST /api/sources logic: check write permission, validate input, then create a source. */
export async function createSourceService(params: CreateSourceParams): Promise<Source> {
  const { input, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }

  const title = validateStringField(input.Title, 'Title', 500);
  if (!title) throw new ValidationError('Title is required');
  validateSourceType(input.Type);

  const source = await createSource(
    {
      OwnerId: scope.ownerId,
      TreeId: scope.treeId,
      Title: title,
      Author: input.Author ?? null,
      PublicationInfo: input.PublicationInfo ?? null,
      RepositoryName: input.RepositoryName ?? null,
      CallNumber: input.CallNumber ?? null,
      Text: input.Text ?? null,
      Type: (input.Type as Source['Type']) ?? 'Document',
      Contents: input.Contents ?? null,
    },
    currentUserId
  );
  // Keep the Repository entity link in sync with the free-text repository name.
  await syncSourceRepository(source.Id, scope.ownerId, scope.treeId, source.RepositoryName);
  return source;
}

export interface UpdateSourceParams {
  id: number;
  patch: UpdateSourceInput;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** PUT /api/sources/[id] logic: check write permission, apply patch, then return updated source. */
export async function updateSourceService(params: UpdateSourceParams): Promise<Source> {
  const { id, patch, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }
  let fields = patch;
  if (patch.Type != null && !isSourceType(patch.Type)) {
    // GEDCOM import keeps a foreign `_TYPE` verbatim, and older rows may predate
    // the vocabulary. Re-saving such a row with its own stored type must still
    // work (the editor always sends Type); any other unknown value is rejected.
    const current = await getSource(id, scope.treeId);
    if (!current) throw new NotFoundError('Source not found');
    if (current.Type !== patch.Type) validateSourceType(patch.Type);
    fields = { ...patch };
    delete fields.Type;
  }

  const source = await updateSource(id, scope.treeId, fields as Parameters<typeof updateSource>[2], currentUserId);
  if (!source) throw new NotFoundError('Source not found');
  // Re-sync the Repository entity link whenever the repository name may have changed.
  if (patch.RepositoryName !== undefined) {
    await syncSourceRepository(source.Id, scope.ownerId, scope.treeId, source.RepositoryName);
  }
  return source;
}

export interface RemoveSourceParams {
  id: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** DELETE /api/sources/[id] logic: check owner permission, then delete source. */
export async function removeSourceService(params: RemoveSourceParams): Promise<void> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }

  const deleted = await deleteSource(id, scope.treeId, currentUserId);
  if (!deleted) throw new NotFoundError('Source not found');
}

export interface CitedBySourceParams {
  id: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/sources/[id]/cited-by logic: validate access, then list all entities citing this source. */
export async function citedBySourceService(params: CitedBySourceParams): Promise<CitedByRow[]> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  return getCitedByForSource(id, scope.treeId);
}
