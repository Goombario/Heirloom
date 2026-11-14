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

/** Contact fields and their length limits (ADR 0049). Looser than GEDCOM's, so an
 *  imported value that ran long can still be saved back unchanged. */
const CONTACT_LIMITS = { Website: 500, Phone: 100, Email: 255 } as const;
type ContactInput = { Website?: string | null; Phone?: string | null; Email?: string | null };

/** The contact fields present in a body, validated; absent ones are left out. */
function contactFields(body: Record<string, unknown>): ContactInput {
  const out: ContactInput = {};
  for (const [field, max] of Object.entries(CONTACT_LIMITS) as Array<[keyof typeof CONTACT_LIMITS, number]>) {
    const value = body[field];
    if (value === undefined) continue;
    // One GEDCOM line each, so a pasted line break becomes a space.
    out[field] = value === null ? null : validateStringField(value, field, max)?.replace(/\s*[\r\n]+\s*/g, ' ').trim() || null;
  }
  return out;
}

export interface CreateRepositoryParams extends RepositoryServiceBase {
  body: { Name?: unknown; Address?: unknown; Website?: unknown; Phone?: unknown; Email?: unknown };
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

  const repo = await createRepository(scope.ownerId, scope.treeId, { Name: name, Address: address, ...contactFields(body) });
  if (!repo) throw new ValidationError('A repository with this name already exists');
  return repo;
}

export interface UpdateRepositoryParams extends RepositoryByIdParams {
  body: { Name?: unknown; Address?: unknown; Website?: unknown; Phone?: unknown; Email?: unknown };
}

/** PUT /api/repositories/[id] — check write permission, validate, then update name, address and contacts. */
export async function updateRepositoryService(params: UpdateRepositoryParams): Promise<Repository> {
  const { id, body, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');

  const fields: { Name?: string; Address?: string | null } & ContactInput = contactFields(body);
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
