import type {
  Audited, AuditedChange, FamiliesClient, FamilyInput, FamilyDetail, ChildRelationshipInput,
} from '../types';
import type { Family } from '@/lib/db/schema';
import type { FamilyWithSpouseNames } from '@/lib/db/queries/families';
import { auditIdsFrom, ensureAuditIds, throwForStatus, treeQuery } from './shared';

/** Families methods backed by the hosted REST API (`/api/families*`). */
export class HttpFamiliesClient implements FamiliesClient {
  async list(treeId?: number | null): Promise<{ families: FamilyWithSpouseNames[]; count: number }> {
    const res = await fetch(`/api/families${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as { families: FamilyWithSpouseNames[]; count: number };
  }

  async create(input: FamilyInput, treeId?: number | null): Promise<Audited<Family>> {
    const res = await fetch(`/api/families${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { family: Audited<Family> }).family);
  }

  async get(id: number, treeId?: number | null): Promise<FamilyDetail> {
    const res = await fetch(`/api/families/${id}${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as FamilyDetail;
  }

  async update(id: number, patch: FamilyInput, treeId?: number | null): Promise<Audited<Family>> {
    const res = await fetch(`/api/families/${id}${treeQuery(treeId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { family: Audited<Family> }).family);
  }

  async remove(id: number, treeId?: number | null): Promise<AuditedChange> {
    const res = await fetch(`/api/families/${id}${treeQuery(treeId)}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
    return auditedChangeFrom(res);
  }

  async search(q: string, treeId?: number | null): Promise<FamilyWithSpouseNames[]> {
    const params = new URLSearchParams({ q });
    if (treeId != null) params.set('treeId', String(treeId));
    const res = await fetch(`/api/families/search?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { families: FamilyWithSpouseNames[] }).families;
  }

  async addChild(familyId: number, childId: number, relationship: ChildRelationshipInput = 'Birth', treeId?: number | null): Promise<Audited> {
    const res = await fetch(`/api/families/${familyId}/children${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId, relationshipType: relationship }),
    });
    if (!res.ok) await throwForStatus(res);
    return auditIdsFrom(res);
  }

  async updateChildType(familyId: number, childId: number, relationship: ChildRelationshipInput, treeId?: number | null): Promise<Audited> {
    const res = await fetch(`/api/families/${familyId}/children${treeQuery(treeId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId, relationshipType: relationship }),
    });
    if (!res.ok) await throwForStatus(res);
    return auditIdsFrom(res);
  }

  async removeChild(familyId: number, childId: number, treeId?: number | null): Promise<AuditedChange> {
    const res = await fetch(`/api/families/${familyId}/children${treeQuery(treeId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId }),
    });
    if (!res.ok) await throwForStatus(res);
    return auditedChangeFrom(res);
  }

  async moveChild(familyId: number, childId: number, toFamilyId: number, treeId?: number | null): Promise<AuditedChange> {
    const res = await fetch(`/api/families/${familyId}/children/move${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId, toFamilyId }),
    });
    if (!res.ok) await throwForStatus(res);
    return auditedChangeFrom(res);
  }
}

/** `{ auditId }` from a delete response; a body-less 204 (an older server) has none. */
async function auditedChangeFrom(res: Response): Promise<AuditedChange> {
  if (res.status === 204) return { auditId: null };
  const body = (await res.json().catch(() => null)) as { auditId?: unknown } | null;
  return { auditId: typeof body?.auditId === 'number' ? body.auditId : null };
}
