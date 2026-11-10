import type { DataCheckEntry, DataChecksClient, DataChecksFilter, DataChecksResult, DataChecksSummary } from '../types';
import type { DataCheckInput } from '@/lib/data-checks/rules';
import { throwForStatus, treeQuery } from './shared';

/** Data checks backed by the hosted REST API. */
export class HttpDataChecksClient implements DataChecksClient {
  async list(treeId?: number | null, filter: DataChecksFilter = {}): Promise<DataChecksResult> {
    const params = new URLSearchParams();
    if (treeId != null) params.set('treeId', String(treeId));
    if (filter.personId != null) params.set('personId', String(filter.personId));
    if (filter.familyId != null) params.set('familyId', String(filter.familyId));
    const q = params.toString();
    const res = await fetch(`/api/data-checks${q ? `?${q}` : ''}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as DataChecksResult;
  }

  async summary(treeId?: number | null): Promise<DataChecksSummary> {
    const res = await fetch(`/api/data-checks/summary${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as DataChecksSummary;
  }

  async confirm(problemId: string, reason: string, treeId?: number | null): Promise<DataCheckEntry> {
    const res = await fetch(`/api/data-checks/confirmations${treeQuery(treeId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ problemId, reason }),
    });
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { entry: DataCheckEntry }).entry;
  }

  async reopen(problemId: string, treeId?: number | null): Promise<void> {
    const params = new URLSearchParams({ problemId });
    if (treeId != null) params.set('treeId', String(treeId));
    const res = await fetch(`/api/data-checks/confirmations?${params}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
  }

  async neighbourhood(personId: number, treeId?: number | null): Promise<DataCheckInput> {
    const params = new URLSearchParams({ personId: String(personId) });
    if (treeId != null) params.set('treeId', String(treeId));
    const res = await fetch(`/api/data-checks/neighbourhood?${params}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { neighbourhood: DataCheckInput }).neighbourhood;
  }
}
