import type { AuditClient, AuditListOptions, AuditListResult, AuditEditorsResult } from '../types';
import { throwForStatus, treeQuery } from './shared';

/** Audit log backed by the hosted REST API (`/api/audit`). */
export class HttpAuditClient implements AuditClient {
  async list(options: AuditListOptions = {}): Promise<AuditListResult> {
    const params = new URLSearchParams();
    if (options.treeId != null) params.set('treeId', String(options.treeId));
    if (options.page != null) params.set('page', String(options.page));
    if (options.pageSize != null) params.set('pageSize', String(options.pageSize));
    if (options.entityType) params.set('entityType', options.entityType);
    if (options.action) params.set('action', options.action);
    if (options.who != null) params.set('who', String(options.who));
    if (options.dateFrom) params.set('dateFrom', options.dateFrom);
    if (options.dateTo) params.set('dateTo', options.dateTo);
    if (options.search) params.set('search', options.search);
    if (options.sort) params.set('sort', options.sort);
    if (options.dir) params.set('dir', options.dir);
    const qs = params.toString();
    const res = await fetch(`/api/audit${qs ? `?${qs}` : ''}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as AuditListResult;
  }

  async users(treeId?: number | null): Promise<AuditEditorsResult> {
    const res = await fetch(`/api/audit/users${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as AuditEditorsResult;
  }

  async revert(ids: number[], treeId?: number | null): Promise<{ success: true; revertedCount: number }> {
    const res = await fetch(`/api/audit/revert${treeQuery(treeId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    });
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as { success: true; revertedCount: number };
  }
}
