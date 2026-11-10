import type { Audited, CitationsClient, CreateCitationInput, CreateCitationsInput, UpdateCitationInput } from '../types';
import type { Citation } from '@/lib/db/queries/citations';
import type { FactTableValue } from '@/lib/db/fact-tables';
import { auditIdsFrom, ensureAuditIds, throwForStatus, treeQuery } from './shared';

/** Citations backed by the hosted REST API (`/api/citations`). */
export class HttpCitationsClient implements CitationsClient {
  async listForPerson(personId: number, treeId?: number | null): Promise<Record<string, Citation[]>> {
    const params = new URLSearchParams({ personId: String(personId) });
    if (treeId != null) params.set('treeId', String(treeId));
    const res = await fetch(`/api/citations?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { citationMap: Record<string, Citation[]> }).citationMap;
  }

  async listForFamily(familyId: number, treeId?: number | null): Promise<Record<string, Citation[]>> {
    const params = new URLSearchParams({ familyId: String(familyId) });
    if (treeId != null) params.set('treeId', String(treeId));
    const res = await fetch(`/api/citations?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { citationMap: Record<string, Citation[]> }).citationMap;
  }

  async listForFact(factTable: FactTableValue, factId: number, treeId?: number | null): Promise<Citation[]> {
    const params = new URLSearchParams({ factTable, factId: String(factId) });
    if (treeId != null) params.set('treeId', String(treeId));
    const res = await fetch(`/api/citations?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { citations: Citation[] }).citations;
  }

  async create(input: CreateCitationInput, treeId?: number | null): Promise<Audited<Citation>> {
    const res = await fetch(`/api/citations${treeQuery(treeId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { citation: Audited<Citation> }).citation);
  }

  async createMany(input: CreateCitationsInput, treeId?: number | null): Promise<Citation[]> {
    const res = await fetch(`/api/citations/bulk${treeQuery(treeId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { citations: Citation[] }).citations;
  }

  async update(id: number, patch: UpdateCitationInput, treeId?: number | null): Promise<Audited<Citation>> {
    const res = await fetch(`/api/citations/${id}${treeQuery(treeId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { citation: Audited<Citation> }).citation);
  }

  async remove(id: number, treeId?: number | null): Promise<Audited> {
    const res = await fetch(`/api/citations/${id}${treeQuery(treeId)}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
    return auditIdsFrom(res);
  }
}
