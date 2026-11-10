import {
  getRepositoriesWithCounts,
  getRepositoryById,
  getSourcesForRepository,
  createRepository,
  updateRepository,
  deleteRepository,
  type Repository,
  type RepositoryWithCount,
} from '@/lib/db/queries/repositories';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { validateStringField, ValidationError } from '@/lib/validation';

export interface RepositoryServiceBase {
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/repositories — validate access, then list repositories with source counts. */
export async function listRepositoriesService(params: RepositoryServiceBase): Promise<RepositoryWithCount[]> {
  const { requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  return getRepositoriesWithCounts(scope.treeId);
}

export interface RepositoryByIdParams extends RepositoryServiceBase {
  id: number;
}

/** GET /api/repositories/[id] — validate access, then fetch one repository. */
export async function getRepositoryService(params: RepositoryByIdParams): Promise<Repository> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  const repo = await getRepositoryById(id, scope.treeId);
  if (!repo) throw new NotFoundError('Repository not found');
  return repo;
}

/** GET /api/repositories/[id]/sources — validate access, then list the sources it holds. */
export async function listSourcesForRepositoryService(
  params: RepositoryByIdParams,
): Promise<{ Id: number; Title: string | null }[]> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  return getSourcesForRepository(id, scope.treeId);
}

export interface CreateRepositoryParams extends RepositoryServiceBase {
  body: { Name?: unknown; Address?: unknown };
}

/** POST /api/repositories — check write permission, validate, then create. */
export async function createRepositoryService(params: CreateRepositoryParams): Promise<Repository> {
  const { body, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const name = validateStringField(body.Name, 'Name', 255);
  if (!name) throw new ValidationError('Name is required');
  const address = body.Address === undefined || body.Address === null
    ? null
    : validateStringField(body.Address, 'Address', 500) || null;

  const repo = await createRepository(scope.ownerId, scope.treeId, { Name: name, Address: address });
  if (!repo) throw new ValidationError('A repository with this name already exists');
  return repo;
}

export interface UpdateRepositoryParams extends RepositoryByIdParams {
  body: { Name?: unknown; Address?: unknown };
}

/** PUT /api/repositories/[id] — check write permission, validate, then update name/address. */
export async function updateRepositoryService(params: UpdateRepositoryParams): Promise<Repository> {
  const { id, body, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const fields: { Name?: string; Address?: string | null } = {};
  if (body.Name !== undefined) {
    const name = validateStringField(body.Name, 'Name', 255);
    if (!name) throw new ValidationError('Name is required');
    fields.Name = name;
  }
  if (body.Address !== undefined) {
    fields.Address = body.Address === null ? null : validateStringField(body.Address, 'Address', 500) || null;
  }

  const repo = await updateRepository(id, scope.treeId, fields);
  if (!repo) throw new NotFoundError('Repository not found');
  return repo;
}

/** DELETE /api/repositories/[id] — deletes need owner/edit ('contribute' blocks deletes, same as top-level entities). */
export async function removeRepositoryService(params: RepositoryByIdParams): Promise<void> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }

  const deleted = await deleteRepository(id, scope.treeId);
  if (!deleted) throw new NotFoundError('Repository not found');
}
