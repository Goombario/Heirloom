import type {
  Audited, CaseNoteStrike, CasesClient, ListCasesOptions, CreateCaseInput, UpdateCaseInput, AddCommentInput, LinkMediaInput,
  CaseClaimInput, CaseFindingInput, CaseLeadChange, CaseLeadInput, CaseRequestInput, CaseWorkspaceWrite,
} from '../types';
import type { Case, CaseClaimDecision, CaseComment, CaseRequestState, CaseWithRelations, CaseWorkspace, MediaWithPerson } from '@/lib/db/schema';

async function send(method: 'POST' | 'PATCH', url: string, body: unknown): Promise<CaseWorkspaceWrite> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) await throwForStatus(res);
  return (await res.json()) as CaseWorkspaceWrite;
}
import { ensureAuditIds, throwForStatus, treeQuery } from './shared';

/** Cases backed by the hosted REST API (`/api/cases`). */
export class HttpCasesClient implements CasesClient {
  async list(options: ListCasesOptions = {}): Promise<{ cases: CaseWithRelations[]; count: number }> {
    const params = new URLSearchParams();
    if (options.treeId != null) params.set('treeId', String(options.treeId));
    if (options.status) params.set('status', options.status);
    if (options.tag) params.set('tag', options.tag);
    if (options.search) params.set('search', options.search);
    if (options.personId != null) params.set('personId', String(options.personId));
    const qs = params.toString();
    const res = await fetch(`/api/cases${qs ? `?${qs}` : ''}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as { cases: CaseWithRelations[]; count: number };
  }

  async get(id: number, treeId?: number | null): Promise<CaseWithRelations> {
    const res = await fetch(`/api/cases/${id}${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { case: CaseWithRelations }).case;
  }

  async create(input: CreateCaseInput, treeId?: number | null): Promise<Case> {
    const res = await fetch(`/api/cases${treeQuery(treeId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { case: Case }).case;
  }

  async update(id: number, patch: UpdateCaseInput, treeId?: number | null): Promise<Case> {
    const res = await fetch(`/api/cases/${id}${treeQuery(treeId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { case: Case }).case;
  }

  async remove(id: number, treeId?: number | null): Promise<void> {
    const res = await fetch(`/api/cases/${id}${treeQuery(treeId)}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
  }

  async addComment(id: number, input: AddCommentInput, treeId?: number | null): Promise<CaseComment> {
    const res = await fetch(`/api/cases/${id}/comments${treeQuery(treeId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { comment: CaseComment }).comment;
  }

  async strikeComment(id: number, commentId: number, reason: string | null, treeId?: number | null): Promise<Audited<CaseNoteStrike>> {
    const res = await fetch(`/api/cases/${id}/comments/${commentId}/strike${treeQuery(treeId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds((await res.json()) as CaseNoteStrike);
  }

  async unstrikeComment(id: number, commentId: number, treeId?: number | null): Promise<Audited<CaseNoteStrike>> {
    const res = await fetch(`/api/cases/${id}/comments/${commentId}/strike${treeQuery(treeId)}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds((await res.json()) as CaseNoteStrike);
  }

  async listMediaLibrary(id: number, treeId?: number | null): Promise<MediaWithPerson[]> {
    const res = await fetch(`/api/cases/${id}/media/library${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { media: MediaWithPerson[] }).media;
  }

  async linkMedia(id: number, input: LinkMediaInput, treeId?: number | null): Promise<{ linked: number }> {
    const res = await fetch(`/api/cases/${id}/media${treeQuery(treeId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as { linked: number };
  }

  async unlinkMedia(id: number, mediaId: number, treeId?: number | null): Promise<void> {
    const res = await fetch(`/api/cases/${id}/media/${mediaId}${treeQuery(treeId)}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
  }

  async getWorkspace(id: number, treeId?: number | null): Promise<CaseWorkspace> {
    const res = await fetch(`/api/cases/${id}/workspace${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { workspace: CaseWorkspace }).workspace;
  }

  async addLead(id: number, input: CaseLeadInput, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return send('POST', `/api/cases/${id}/leads${treeQuery(treeId)}`, input);
  }

  async changeLead(id: number, leadId: number, change: CaseLeadChange, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return send('PATCH', `/api/cases/${id}/leads/${leadId}${treeQuery(treeId)}`, change);
  }

  async addFinding(id: number, input: CaseFindingInput, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return send('POST', `/api/cases/${id}/findings${treeQuery(treeId)}`, input);
  }

  async addClaim(id: number, findingId: number, input: CaseClaimInput, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return send('POST', `/api/cases/${id}/findings/${findingId}/claims${treeQuery(treeId)}`, input);
  }

  async decideClaim(id: number, claimId: number, decision: CaseClaimDecision, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return send('PATCH', `/api/cases/${id}/claims/${claimId}${treeQuery(treeId)}`, { decision });
  }

  async addRequest(id: number, input: CaseRequestInput, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return send('POST', `/api/cases/${id}/requests${treeQuery(treeId)}`, input);
  }

  async replyToRequest(id: number, requestId: number, reply: { state: CaseRequestState; note?: string | null }, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return send('PATCH', `/api/cases/${id}/requests/${requestId}${treeQuery(treeId)}`, reply);
  }
}
