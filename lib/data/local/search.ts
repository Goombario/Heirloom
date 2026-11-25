import type { SearchClient } from '../types';
import {
  deleteSavedSearchService, listSavedSearchesService, loadPeopleSearchIndex, saveSearchService, searchPeopleService,
  type PeopleSearchIndexLoader, type PeopleSearchResponse, type SavedSearch,
} from '@/lib/services/advanced-search';
import type { PeopleSearchIndex } from '@/lib/search/evaluate-people';
import type { SearchQuery } from '@/lib/search/people-query';
import { localDataChecksLoader } from './data-checks';
import { memoUntilWrite } from './memo-until-write';
import { ensureLocalUser } from '../local-user';

/**
 * A tree's search index, kept until the next write, so the live count doesn't
 * re-read the tree on every change to a condition. It holds every slice, so
 * any query can run on it.
 */
const indexes = memoUntilWrite<number, PeopleSearchIndex>();
const ALL = new Set<keyof PeopleSearchIndex>(['people', 'names', 'families', 'children', 'events', 'places', 'citations', 'cases', 'notes', 'problems']);
const cachedIndex: PeopleSearchIndexLoader = (treeId, _slices, scope) =>
  indexes.get(treeId, () => loadPeopleSearchIndex(treeId, ALL, scope, localDataChecksLoader));

/** Advanced search over in-browser PGlite: the same service and evaluator as the server. */
export class LocalSearchClient implements SearchClient {
  async people(query: SearchQuery, treeId?: number | null, options: { explain?: boolean } = {}): Promise<PeopleSearchResponse> {
    const currentUserId = await ensureLocalUser();
    return searchPeopleService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, query, explain: options.explain }, cachedIndex);
  }

  async listSaved(treeId?: number | null): Promise<SavedSearch[]> {
    const currentUserId = await ensureLocalUser();
    return listSavedSearchesService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId }, cachedIndex);
  }

  async save(name: string, query: SearchQuery, treeId?: number | null): Promise<{ id: number }> {
    const currentUserId = await ensureLocalUser();
    return saveSearchService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, name, query });
  }

  async removeSaved(id: number, treeId?: number | null): Promise<void> {
    const currentUserId = await ensureLocalUser();
    await deleteSavedSearchService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId, id });
  }
}
