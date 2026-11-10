import type { RepositoriesClient, CreateRepositoryInput, UpdateRepositoryInput, Repository, RepositoryWithCount } from '../types';
import {
  listRepositoriesService,
  getRepositoryService,
  listSourcesForRepositoryService,
  createRepositoryService,
  updateRepositoryService,
  removeRepositoryService,
} from '@/lib/services/repositories';
import { ensureLocalUser } from '../local-user';

/**
 * Repositories backed by in-browser PGlite.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree);
 * `requestedOwnerId` stays null (sharing is a hosted-only concept).
 */
export class LocalRepositoriesClient implements RepositoriesClient {
  async list(treeId?: number | null): Promise<RepositoryWithCount[]> {
    const currentUserId = await ensureLocalUser();
    return listRepositoriesService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async get(id: number, treeId?: number | null): Promise<Repository> {
    const currentUserId = await ensureLocalUser();
    return getRepositoryService({ id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async sources(id: number, treeId?: number | null): Promise<{ Id: number; Title: string | null }[]> {
    const currentUserId = await ensureLocalUser();
    return listSourcesForRepositoryService({ id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async create(input: CreateRepositoryInput, treeId?: number | null): Promise<Repository> {
    const currentUserId = await ensureLocalUser();
    return createRepositoryService({ body: input, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async update(id: number, patch: UpdateRepositoryInput, treeId?: number | null): Promise<Repository> {
    const currentUserId = await ensureLocalUser();
    return updateRepositoryService({ id, body: patch, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async remove(id: number, treeId?: number | null): Promise<void> {
    const currentUserId = await ensureLocalUser();
    return removeRepositoryService({ id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }
}
