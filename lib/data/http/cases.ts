import type {
  Audited, CaseNoteStrike, CasesClient, ListCasesOptions, CreateCaseInput, UpdateCaseInput, AddCommentInput, LinkMediaInput,
} from '../types';
import type { Case, CaseComment, CaseWithRelations, MediaWithPerson } from '@/lib/db/schema';
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
}
