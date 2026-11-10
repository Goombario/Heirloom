import type { SourcesClient, CreateSourceInput, UpdateSourceInput } from '../types';
import type { Source } from '@/lib/db/queries/sources';
import type { CitedByRow } from '@/lib/db/queries/citations';
import {
  listSourcesService,
  searchSourcesService,
  getSourceService,
  createSourceService,
  updateSourceService,
  removeSourceService,
  citedBySourceService,
  listRecentlyCitedSourcesService,
} from '@/lib/services/sources';
import { ensureLocalUser } from '../local-user';

/**
 * Sources methods backed by in-browser PGlite.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree);
 * `requestedOwnerId` stays null (sharing is a hosted-only concept).
 */
export class LocalSourcesClient implements SourcesClient {
  async list<T extends Source = Source>(
    options?: { treeId?: number | null; withCounts?: boolean }
  ): Promise<{ sources: T[]; count: number }> {
    const currentUserId = await ensureLocalUser();
    const result = await listSourcesService({
      requestedTreeId: options?.treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
      withCounts: options?.withCounts,
    });
    // The generic is acknowledged as mildly unsound in the interface itself;
    // cast preserves the contract without breaking hosted behaviour.
    return result as unknown as { sources: T[]; count: number };
  }

  async search(q: string, treeId?: number | null): Promise<Source[]> {
    const currentUserId = await ensureLocalUser();
    return searchSourcesService({ q, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async get(id: number, treeId?: number | null): Promise<Source> {
    const currentUserId = await ensureLocalUser();
    return getSourceService({ id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async create(input: CreateSourceInput, treeId?: number | null): Promise<Source> {
    const currentUserId = await ensureLocalUser();
    return createSourceService({ input, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async update(id: number, patch: UpdateSourceInput, treeId?: number | null): Promise<Source> {
    const currentUserId = await ensureLocalUser();
    return updateSourceService({ id, patch, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async remove(id: number, treeId?: number | null): Promise<void> {
    const currentUserId = await ensureLocalUser();
    return removeSourceService({ id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async citedBy(id: number, treeId?: number | null): Promise<CitedByRow[]> {
    const currentUserId = await ensureLocalUser();
    return citedBySourceService({ id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async listRecentlyCited(treeId?: number | null): Promise<Source[]> {
    const currentUserId = await ensureLocalUser();
    return listRecentlyCitedSourcesService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }
}
