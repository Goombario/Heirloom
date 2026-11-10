import type { Audited, CaseNoteStrike, CasesClient, ListCasesOptions, CreateCaseInput, UpdateCaseInput, AddCommentInput, LinkMediaInput } from '../types';
import type { Case, CaseComment, CaseWithRelations, MediaWithPerson } from '@/lib/db/schema';
import {
  listCasesService,
  getCaseService,
  createCaseService,
  updateCaseService,
  deleteCaseService,
  addCommentService,
  strikeCaseNoteService,
  unstrikeCaseNoteService,
  listMediaLibraryService,
  linkMediaService,
  unlinkMediaService,
} from '@/lib/services/cases';
import { ensureLocalUser } from '../local-user';

/**
 * Cases methods backed by in-browser PGlite.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree);
 * `requestedOwnerId` stays null (sharing is a hosted-only concept).
 */
export class LocalCasesClient implements CasesClient {
  async list(options?: ListCasesOptions): Promise<{ cases: CaseWithRelations[]; count: number }> {
    const currentUserId = await ensureLocalUser();
    return listCasesService({
      requestedTreeId: options?.treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
      status: options?.status,
      tag: options?.tag,
      search: options?.search,
      personId: options?.personId,
    });
  }

  async get(id: number, treeId?: number | null): Promise<CaseWithRelations> {
    const currentUserId = await ensureLocalUser();
    return getCaseService({ id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async create(input: CreateCaseInput, treeId?: number | null): Promise<Case> {
    const currentUserId = await ensureLocalUser();
    return createCaseService({
      body: input as unknown as Record<string, unknown>,
      requestedTreeId: treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
    });
  }

  async update(id: number, patch: UpdateCaseInput, treeId?: number | null): Promise<Case> {
    const currentUserId = await ensureLocalUser();
    return updateCaseService({
      id,
      body: patch as unknown as Record<string, unknown>,
      requestedTreeId: treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
    });
  }

  async remove(id: number, treeId?: number | null): Promise<void> {
    const currentUserId = await ensureLocalUser();
    return deleteCaseService({ id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async addComment(id: number, input: AddCommentInput, treeId?: number | null): Promise<CaseComment> {
    const currentUserId = await ensureLocalUser();
    return addCommentService({
      id,
      body: input.body,
      mediaId: input.mediaId,
      requestedTreeId: treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
    });
  }

  async strikeComment(id: number, commentId: number, reason: string | null, treeId?: number | null): Promise<Audited<CaseNoteStrike>> {
    const currentUserId = await ensureLocalUser();
    return strikeCaseNoteService({ caseId: id, commentId, reason, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async unstrikeComment(id: number, commentId: number, treeId?: number | null): Promise<Audited<CaseNoteStrike>> {
    const currentUserId = await ensureLocalUser();
    return unstrikeCaseNoteService({ caseId: id, commentId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async listMediaLibrary(id: number, treeId?: number | null): Promise<MediaWithPerson[]> {
    const currentUserId = await ensureLocalUser();
    return listMediaLibraryService({ id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async linkMedia(id: number, input: LinkMediaInput, treeId?: number | null): Promise<{ linked: number }> {
    const currentUserId = await ensureLocalUser();
    return linkMediaService({ id, mediaIds: input.mediaIds, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async unlinkMedia(id: number, mediaId: number, treeId?: number | null): Promise<void> {
    const currentUserId = await ensureLocalUser();
    // In local mode there is no server file-system — the service handles the DB side only.
    await unlinkMediaService({ id, mediaId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }
}
