import type {
  MediaClient, ListMediaOptions, UploadMediaInput, UpdateMediaInput, CreateMediaTagInput, UpdateMediaTagInput, FaceConfirmBatchResult, FaceGroup,
  DuplicateMatch,
  MediaStorageSummary,
} from '../types';
import type { Audited, MediaDeleteBatchResult } from '../types';
import type { Media, MediaLinkOwner, MediaTag, MediaTagWithPerson, FaceDismissReason, OwnerGalleryMedia } from '@/lib/db/schema';
import type { LinkOwnerTable, MediaOwnerFact, MediaOwnerTable } from '@/lib/db/fact-tables';
import type { FaceSuggestionSnapshot } from '@/lib/db/queries/media-faces';
import { auditIdsFrom, ensureAuditIds, throwForStatus, treeQuery } from './shared';
import { NotImplementedError } from '../errors';

/** Builds and POSTs a face-queue mutation, sharing query-string + error handling. */
async function postFaces(action: string, body: Record<string, unknown>, treeId?: number | null) {
  const res = await fetch(`/api/media/faces/${action}${treeQuery(treeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwForStatus(res);
  return res.json();
}

/** Media methods backed by the hosted REST API (`/api/media`). */
export class HttpMediaClient implements MediaClient {
  async list<T extends Media = Media>(options: ListMediaOptions = {}): Promise<{ media: T[]; count: number }> {
    const params = new URLSearchParams();
    if (options.treeId != null) params.set('treeId', String(options.treeId));
    if (options.personId != null) params.set('personId', String(options.personId));
    if (options.withPerson) params.set('withPerson', 'true');
    if (options.includeTagged) params.set('includeTagged', 'true');
    const qs = params.toString();
    const res = await fetch(`/api/media${qs ? `?${qs}` : ''}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as { media: T[]; count: number };
  }

  async getStorageSummary(treeId?: number | null): Promise<MediaStorageSummary> {
    const res = await fetch(`/api/media/storage${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as MediaStorageSummary;
  }

  async listForOwner(ownerTable: LinkOwnerTable, ownerId: number, treeId?: number | null, ownerFact?: MediaOwnerFact): Promise<Media[]> {
    const params = new URLSearchParams({ ownerTable, recordId: String(ownerId) });
    if (treeId != null) params.set('treeId', String(treeId));
    if (ownerFact) params.set('ownerFact', ownerFact);
    const res = await fetch(`/api/media?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { media: Media[] }).media;
  }

  async listGalleryForOwner(ownerTable: MediaOwnerTable, ownerId: number, treeId?: number | null, ownerFact?: MediaOwnerFact): Promise<OwnerGalleryMedia[]> {
    const params = new URLSearchParams({ ownerTable, recordId: String(ownerId), gallery: 'true' });
    if (treeId != null) params.set('treeId', String(treeId));
    if (ownerFact) params.set('ownerFact', ownerFact);
    const res = await fetch(`/api/media?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { media: OwnerGalleryMedia[] }).media;
  }

  async unlinkFromOwner(id: number, ownerTable: LinkOwnerTable, ownerId: number, treeId?: number | null, ownerFact?: MediaOwnerFact): Promise<void> {
    const params = new URLSearchParams({ ownerTable, recordId: String(ownerId) });
    if (treeId != null) params.set('treeId', String(treeId));
    if (ownerFact) params.set('ownerFact', ownerFact);
    const res = await fetch(`/api/media/${id}?${params.toString()}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
  }

  async linkToOwner(mediaId: number, ownerTable: LinkOwnerTable, ownerId: number, treeId?: number | null, ownerFact?: MediaOwnerFact): Promise<void> {
    const qs = treeId != null ? `?treeId=${treeId}` : '';
    const res = await fetch(`/api/media/${mediaId}/links${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerTable, recordId: ownerId, ...(ownerFact ? { ownerFact } : {}) }),
    });
    if (!res.ok) await throwForStatus(res);
  }

  async listLinkOwners(mediaId: number, treeId?: number | null): Promise<MediaLinkOwner[]> {
    const res = await fetch(`/api/media/${mediaId}/links${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { owners: MediaLinkOwner[] }).owners;
  }

  async upload(input: UploadMediaInput, treeId?: number | null): Promise<Media> {
    const fd = new FormData();
    fd.append('file', input.file);
    if (input.uploadIntentId) fd.append('uploadIntentId', input.uploadIntentId);
    if (input.personId != null) fd.append('personId', String(input.personId));
    if (input.title) fd.append('title', input.title);
    if (input.isPrimary) fd.append('isPrimary', 'true');
    if (input.caseId != null) fd.append('caseId', String(input.caseId));
    if (input.ownerTable != null) fd.append('ownerTable', input.ownerTable);
    if (input.ownerRecordId != null) fd.append('ownerRecordId', String(input.ownerRecordId));
    if (input.ownerFact != null) fd.append('ownerFact', input.ownerFact);
    if (treeId != null) fd.append('treeId', String(treeId));
    const res = await fetch('/api/media/upload', { method: 'POST', body: fd });
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { media: Media }).media;
  }

  async findDuplicates(hashes: string[], treeId?: number | null): Promise<DuplicateMatch[]> {
    const res = await fetch(`/api/media/duplicates${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes }),
    });
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { matches: DuplicateMatch[] }).matches;
  }

  async update(id: number, patch: UpdateMediaInput, treeId?: number | null): Promise<Audited<Media>> {
    const res = await fetch(`/api/media/${id}${treeQuery(treeId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { media: Audited<Media> }).media);
  }

  async setPrimary(mediaId: number, personId: number, treeId?: number | null): Promise<Audited> {
    const res = await fetch(`/api/media/${mediaId}/primary${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId }),
    });
    if (!res.ok) await throwForStatus(res);
    return auditIdsFrom(res);
  }

  async clearPrimary(mediaId: number, personId: number, treeId?: number | null): Promise<Audited> {
    const qs = new URLSearchParams({ personId: String(personId) });
    if (treeId != null) qs.set('treeId', String(treeId));
    const res = await fetch(`/api/media/${mediaId}/primary?${qs.toString()}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
    return auditIdsFrom(res);
  }

  async listTags(mediaId: number, treeId?: number | null): Promise<MediaTagWithPerson[]> {
    const res = await fetch(`/api/media/${mediaId}/tags${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { tags: MediaTagWithPerson[] }).tags;
  }

  async createTag(mediaId: number, input: CreateMediaTagInput, treeId?: number | null): Promise<Audited<MediaTag>> {
    const res = await fetch(`/api/media/${mediaId}/tags${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { tag: Audited<MediaTag> }).tag);
  }

  async updateTag(mediaId: number, tagId: number, input: UpdateMediaTagInput, treeId?: number | null): Promise<Audited<MediaTagWithPerson>> {
    const res = await fetch(`/api/media/${mediaId}/tags/${tagId}${treeQuery(treeId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { tag: Audited<MediaTagWithPerson> }).tag);
  }

  async removeTag(mediaId: number, tagId: number, treeId?: number | null): Promise<void> {
    const res = await fetch(`/api/media/${mediaId}/tags/${tagId}${treeQuery(treeId)}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
  }

  async remove(id: number, treeId?: number | null): Promise<void> {
    const res = await fetch(`/api/media/${id}${treeQuery(treeId)}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
  }

  async removeMany(ids: number[], treeId?: number | null): Promise<MediaDeleteBatchResult> {
    const res = await fetch(`/api/media${treeQuery(treeId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as MediaDeleteBatchResult;
  }

  async listFaceQueue(options?: { resolved?: boolean; countOnly?: boolean; mediaId?: number }, treeId?: number | null): Promise<{ groups: FaceGroup[]; pendingTotal: number; resolvedTotal: number }> {
    const params = new URLSearchParams();
    if (treeId != null) params.set('treeId', String(treeId));
    if (options?.resolved) params.set('resolved', 'true');
    if (options?.countOnly) params.set('countOnly', 'true');
    if (options?.mediaId != null) params.set('mediaId', String(options.mediaId));
    const res = await fetch(`/api/media/faces?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as { groups: FaceGroup[]; pendingTotal: number; resolvedTotal: number };
  }

  async confirmFaces(candidateIds: number[], personId: number, treeId?: number | null): Promise<FaceConfirmBatchResult> {
    return postFaces('confirm', { candidateIds, personId }, treeId);
  }

  async repointFaces(candidateIds: number[], personId: number, treeId?: number | null): Promise<{ repointed: number; personName: string | null; previous: FaceSuggestionSnapshot[] }> {
    return postFaces('repoint', { candidateIds, personId }, treeId);
  }

  async restoreFaceSuggestions(previous: FaceSuggestionSnapshot[], treeId?: number | null): Promise<{ restored: number }> {
    return postFaces('restore', { previous }, treeId);
  }

  async dismissFaces(candidateIds: number[], reason: FaceDismissReason, treeId?: number | null): Promise<{ dismissed: number }> {
    return postFaces('dismiss', { candidateIds, reason }, treeId);
  }

  async undoFaces(candidateIds: number[], treeId?: number | null): Promise<{ restored: number; skipped: number }> {
    return postFaces('undo', { candidateIds }, treeId);
  }

  // Hosted rendering uses the /api/media/{id}/file URL directly (mediaFileUrl),
  // so the byte-reading path is never exercised in http mode.
  async getFile(): Promise<{ bytes: Uint8Array; contentType: string }> {
    throw new NotImplementedError('media.getFile (http uses the file URL)');
  }

  async getThumb(): Promise<{ bytes: Uint8Array; contentType: string }> {
    throw new NotImplementedError('media.getThumb (http uses the file URL + ?w=)');
  }
}
