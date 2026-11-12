import type {
  Audited, CaseNoteStrike, CasesClient, ListCasesOptions, CreateCaseInput, UpdateCaseInput, AddCommentInput, LinkMediaInput,
  CaseClaimInput, CaseFindingInput, CaseLeadChange, CaseLeadInput, CaseRequestInput, CaseWorkspaceWrite,
} from '../types';
import type { Case, CaseClaimDecision, CaseComment, CaseRequestState, CaseWithRelations, CaseWorkspace, MediaWithPerson } from '@/lib/db/schema';
import {
  addClaimService, addFindingService, addLeadService, addRequestService, changeLeadService, decideClaimService,
  getCaseWorkspaceService, replyToRequestService,
} from '@/lib/services/case-workspace';
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
      leadIds: input.leadIds,
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

  private async scope(id: number, treeId?: number | null) {
    return { caseId: id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId: await ensureLocalUser() };
  }

  async getWorkspace(id: number, treeId?: number | null): Promise<CaseWorkspace> {
    return getCaseWorkspaceService(await this.scope(id, treeId));
  }

  async addLead(id: number, input: CaseLeadInput, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return addLeadService({ ...(await this.scope(id, treeId)), body: input });
  }

  async changeLead(id: number, leadId: number, change: CaseLeadChange, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return changeLeadService({ ...(await this.scope(id, treeId)), leadId, body: change });
  }

  async addFinding(id: number, input: CaseFindingInput, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return addFindingService({ ...(await this.scope(id, treeId)), body: input });
  }

  async addClaim(id: number, findingId: number, input: CaseClaimInput, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return addClaimService({ ...(await this.scope(id, treeId)), findingId, body: input });
  }

  async decideClaim(id: number, claimId: number, decision: CaseClaimDecision, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return decideClaimService({ ...(await this.scope(id, treeId)), claimId, body: { decision } });
  }

  async addRequest(id: number, input: CaseRequestInput, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return addRequestService({ ...(await this.scope(id, treeId)), body: input });
  }

  async replyToRequest(id: number, requestId: number, reply: { state: CaseRequestState; note?: string | null }, treeId?: number | null): Promise<CaseWorkspaceWrite> {
    return replyToRequestService({ ...(await this.scope(id, treeId)), requestId, body: reply });
  }
}
