import type { DashboardClient, DashboardData, Suggestion } from '../types';
import { throwForStatus, treeQuery } from './shared';

/** Dashboard + suggestions backed by the hosted REST API. */
export class HttpDashboardClient implements DashboardClient {
  async get(treeId?: number | null): Promise<DashboardData> {
    const res = await fetch(`/api/dashboard${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as DashboardData;
  }
  async suggestions(treeId?: number | null): Promise<Suggestion[]> {
    const res = await fetch(`/api/suggestions${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { suggestions: Suggestion[] }).suggestions;
  }
}
