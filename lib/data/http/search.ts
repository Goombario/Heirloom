import type { SearchClient } from '../types';
import type { PeopleSearchResponse, SavedSearch } from '@/lib/services/advanced-search';
import type { SearchQuery } from '@/lib/search/people-query';
import { throwForStatus } from './shared';

const withTree = (path: string, treeId?: number | null) => (treeId != null ? `${path}?treeId=${treeId}` : path);

/** Advanced search over the hosted REST API (#247). */
export class HttpSearchClient implements SearchClient {
  async people(query: SearchQuery, treeId?: number | null, options: { explain?: boolean } = {}): Promise<PeopleSearchResponse> {
    const res = await fetch(withTree('/api/people/advanced-search', treeId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, explain: options.explain === true }),
    });
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as PeopleSearchResponse;
  }

  async listSaved(treeId?: number | null): Promise<SavedSearch[]> {
    const res = await fetch(withTree('/api/saved-searches', treeId));
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { searches: SavedSearch[] }).searches;
  }

  async save(name: string, query: SearchQuery, treeId?: number | null): Promise<{ id: number }> {
    const res = await fetch(withTree('/api/saved-searches', treeId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, query }),
    });
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { search: { id: number } }).search;
  }

  async removeSaved(id: number, treeId?: number | null): Promise<void> {
    const res = await fetch(withTree(`/api/saved-searches/${id}`, treeId), { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
  }
}
