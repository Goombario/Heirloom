import type { SourcesClient, CreateSourceInput, UpdateSourceInput } from '../types';
import type { Source } from '@/lib/db/queries/sources';
import type { CitedByRow } from '@/lib/db/queries/citations';
import { throwForStatus, treeQuery } from './shared';

/** Sources backed by the hosted REST API (`/api/sources`). */
export class HttpSourcesClient implements SourcesClient {
  async list<T extends Source = Source>(options: { treeId?: number | null; withCounts?: boolean } = {}): Promise<{ sources: T[]; count: number }> {
    const params = new URLSearchParams();
    if (options.treeId != null) params.set('treeId', String(options.treeId));
    if (options.withCounts) params.set('withCounts', 'true');
    const qs = params.toString();
    const res = await fetch(`/api/sources${qs ? `?${qs}` : ''}`);
    if (!res.ok) await throwForStatus(res);
    const data = (await res.json()) as { sources: T[]; count?: number };
    return { sources: data.sources, count: data.count ?? data.sources.length };
  }

  async search(q: string, treeId?: number | null): Promise<Source[]> {
    const params = new URLSearchParams({ q });
    if (treeId != null) params.set('treeId', String(treeId));
    const res = await fetch(`/api/sources?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { sources: Source[] }).sources;
  }

  async get(id: number, treeId?: number | null): Promise<Source> {
    const res = await fetch(`/api/sources/${id}${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { source: Source }).source;
  }

  async create(input: CreateSourceInput, treeId?: number | null): Promise<Source> {
    const res = await fetch(`/api/sources${treeQuery(treeId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { source: Source }).source;
  }

  async update(id: number, patch: UpdateSourceInput, treeId?: number | null): Promise<Source> {
    const res = await fetch(`/api/sources/${id}${treeQuery(treeId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { source: Source }).source;
  }

  async remove(id: number, treeId?: number | null): Promise<void> {
    const res = await fetch(`/api/sources/${id}${treeQuery(treeId)}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
  }

  async citedBy(id: number, treeId?: number | null): Promise<CitedByRow[]> {
    const res = await fetch(`/api/sources/${id}/cited-by${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { citations: CitedByRow[] }).citations;
  }

  async listRecentlyCited(treeId?: number | null): Promise<Source[]> {
    const params = new URLSearchParams({ recent: 'true' });
    if (treeId != null) params.set('treeId', String(treeId));
    const res = await fetch(`/api/sources?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { sources: Source[] }).sources;
  }
}
