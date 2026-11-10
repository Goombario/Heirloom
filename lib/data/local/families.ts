import type { Audited, AuditedChange, FamiliesClient, FamilyDetail, ChildRelationshipInput } from '../types';
import type { Family } from '@/lib/db/schema';
import type { FamilyWithSpouseNames } from '@/lib/db/queries/families';
import {
  listFamiliesService,
  createFamilyService,
  getFamilyService,
  updateFamilyService,
  deleteFamilyService,
  searchFamiliesService,
  addChildToFamilyService,
  updateChildTypeService,
  removeChildService,
  moveChildService,
} from '@/lib/services/families';
import { ensureLocalUser } from '../local-user';
import type { FamilyInput } from '../types';

/**
 * Families methods backed by in-browser PGlite.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree);
 * `requestedOwnerId` stays null (sharing is a hosted-only concept).
 */
export class LocalFamiliesClient implements FamiliesClient {
  async list(treeId?: number | null): Promise<{ families: FamilyWithSpouseNames[]; count: number }> {
    const currentUserId = await ensureLocalUser();
    return listFamiliesService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async create(input: FamilyInput, treeId?: number | null): Promise<Audited<Family>> {
    const currentUserId = await ensureLocalUser();
    return createFamilyService({ body: input as Record<string, unknown>, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async get(id: number, treeId?: number | null): Promise<FamilyDetail> {
    const currentUserId = await ensureLocalUser();
    return getFamilyService({ id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async update(id: number, patch: FamilyInput, treeId?: number | null): Promise<Audited<Family>> {
    const currentUserId = await ensureLocalUser();
    return updateFamilyService({ id, body: patch as Record<string, unknown>, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async remove(id: number, treeId?: number | null): Promise<AuditedChange> {
    const currentUserId = await ensureLocalUser();
    return deleteFamilyService({ id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async search(q: string, treeId?: number | null): Promise<FamilyWithSpouseNames[]> {
    const currentUserId = await ensureLocalUser();
    return searchFamiliesService({ q, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async addChild(
    familyId: number,
    childId: number,
    relationship?: ChildRelationshipInput,
    treeId?: number | null
  ): Promise<Audited> {
    const currentUserId = await ensureLocalUser();
    return addChildToFamilyService({ familyId, childId, relationship, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async updateChildType(
    familyId: number,
    childId: number,
    relationship: ChildRelationshipInput,
    treeId?: number | null
  ): Promise<Audited> {
    const currentUserId = await ensureLocalUser();
    return updateChildTypeService({ familyId, childId, relationship, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async removeChild(familyId: number, childId: number, treeId?: number | null): Promise<AuditedChange> {
    const currentUserId = await ensureLocalUser();
    return removeChildService({ familyId, childId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async moveChild(familyId: number, childId: number, toFamilyId: number, treeId?: number | null): Promise<AuditedChange> {
    const currentUserId = await ensureLocalUser();
    return moveChildService({ familyId, toFamilyId, childId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }
}

