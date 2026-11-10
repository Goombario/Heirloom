import type { Audited, CitationsClient, CreateCitationInput, CreateCitationsInput, UpdateCitationInput } from '../types';
import type { Citation } from '@/lib/db/queries/citations';
import type { FactTableValue } from '@/lib/db/fact-tables';
import {
  listCitationsForPersonService,
  listCitationsForFamilyService,
  listCitationsForFactService,
  createCitationService,
  createCitationsService,
  updateCitationService,
  removeCitationService,
} from '@/lib/services/citations';
import { ensureLocalUser } from '../local-user';

/**
 * Citations methods backed by in-browser PGlite.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree);
 * `requestedOwnerId` stays null (sharing is a hosted-only concept).
 */
export class LocalCitationsClient implements CitationsClient {
  async listForPerson(
    personId: number,
    treeId?: number | null
  ): Promise<Record<string, Citation[]>> {
    const currentUserId = await ensureLocalUser();
    return listCitationsForPersonService({ personId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async listForFamily(
    familyId: number,
    treeId?: number | null
  ): Promise<Record<string, Citation[]>> {
    const currentUserId = await ensureLocalUser();
    return listCitationsForFamilyService({ familyId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async listForFact(
    factTable: FactTableValue,
    factId: number,
    treeId?: number | null
  ): Promise<Citation[]> {
    const currentUserId = await ensureLocalUser();
    return listCitationsForFactService({ factTable, factId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async create(input: CreateCitationInput, treeId?: number | null): Promise<Audited<Citation>> {
    const currentUserId = await ensureLocalUser();
    return createCitationService({ input, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async createMany(input: CreateCitationsInput, treeId?: number | null): Promise<Citation[]> {
    const currentUserId = await ensureLocalUser();
    return createCitationsService({ input, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async update(id: number, patch: UpdateCitationInput, treeId?: number | null): Promise<Audited<Citation>> {
    const currentUserId = await ensureLocalUser();
    return updateCitationService({ id, input: patch, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async remove(id: number, treeId?: number | null): Promise<Audited> {
    const currentUserId = await ensureLocalUser();
    return removeCitationService({ id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }
}
