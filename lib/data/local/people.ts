import type { Audited, PeopleClient, GetPeopleOptions, GetPeopleResult, CreatePersonInput, UpdatePersonInput, NameVariant, NameVariantDates, CreateNameVariantInput, SuggestFamilyParams, FamilySuggestion } from '../types';
import type { Person, PersonWithRelations } from '@/lib/db/schema';
import type { PersonWithParentFamily } from '@/lib/db/queries/people';
import type { PeopleFlag } from '@/lib/db/queries/data-quality';
import { listPeopleService, createPersonService, getPersonService, updatePersonService, deletePersonService, searchPeopleService, listFlaggedPeopleService, listNameVariantsService, createNameVariantService, setPrimaryNameVariantService, updateNameVariantService, removeNameVariantService, suggestFamilyService, descendantCountService } from '@/lib/services/people';
import { ensureLocalUser } from '../local-user';

/**
 * People methods backed by in-browser PGlite via the shared service layer.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree);
 * `requestedOwnerId` stays null (sharing is a hosted-only concept).
 */
export class LocalPeopleClient implements PeopleClient {
  async list(options: GetPeopleOptions = {}): Promise<GetPeopleResult> {
    const currentUserId = await ensureLocalUser();
    return listPeopleService({ requestedTreeId: options.treeId ?? null,
 requestedOwnerId: null, currentUserId, search: options.search });
  }

  async create(input: CreatePersonInput, options: { treeId?: number | null } = {}): Promise<Audited<Person>> {
    const currentUserId = await ensureLocalUser();
    return createPersonService({
      body: input as Record<string, unknown>,
      requestedTreeId: options.treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
    });
  }

  async get(id: number, treeId?: number | null): Promise<PersonWithRelations> {
    const currentUserId = await ensureLocalUser();
    return getPersonService({ id, requestedTreeId: treeId ?? null,
 requestedOwnerId: null, currentUserId });
  }
  async update(id: number, patch: UpdatePersonInput, treeId?: number | null): Promise<Audited<Person>> {
    const currentUserId = await ensureLocalUser();
    return updatePersonService({
      id,
      body: patch as Record<string, unknown>,
      requestedTreeId: treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
    });
  }
  async remove(id: number, treeId?: number | null): Promise<void> {
    const currentUserId = await ensureLocalUser();
    return deletePersonService({ id, requestedTreeId: treeId ?? null,
 requestedOwnerId: null, currentUserId });
  }
  async search(q: string, treeId?: number | null, limit?: number, options?: { places?: boolean }): Promise<PersonWithParentFamily[]> {
    const currentUserId = await ensureLocalUser();
    return searchPeopleService({ q, requestedTreeId: treeId ?? null,
 requestedOwnerId: null, currentUserId, limit, places: options?.places === true });
  }
  async listFlagged(flag: PeopleFlag, treeId?: number | null): Promise<number[][]> {
    const currentUserId = await ensureLocalUser();
    return listFlaggedPeopleService({ flag, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }
  async listNameVariants(personId: number, treeId?: number | null): Promise<NameVariant[]> {
    const currentUserId = await ensureLocalUser();
    return listNameVariantsService({ personId, requestedTreeId: treeId ?? null,
 requestedOwnerId: null, currentUserId });
  }
  async createNameVariant(
    personId: number,
    body: CreateNameVariantInput,
    treeId?: number | null
  ): Promise<Audited<NameVariant>> {
    const currentUserId = await ensureLocalUser();
    return createNameVariantService({ personId, body, requestedTreeId: treeId ?? null,
 requestedOwnerId: null, currentUserId });
  }
  async setPrimaryNameVariant(
    personId: number,
    variantId: number,
    isPrimary: boolean,
    treeId?: number | null
  ): Promise<Audited<NameVariant>> {
    const currentUserId = await ensureLocalUser();
    return setPrimaryNameVariantService({ personId, variantId, isPrimary, requestedTreeId: treeId ?? null,
 requestedOwnerId: null, currentUserId });
  }
  async updateNameVariant(personId: number, variantId: number, name: string, treeId?: number | null, dates?: NameVariantDates & { Type?: string }): Promise<Audited<NameVariant>> {
    const currentUserId = await ensureLocalUser();
    return updateNameVariantService({ personId, variantId, body: { Name: name, ...dates }, requestedTreeId: treeId ?? null,
 requestedOwnerId: null, currentUserId });
  }
  async removeNameVariant(personId: number, variantId: number, treeId?: number | null): Promise<Audited> {
    const currentUserId = await ensureLocalUser();
    return removeNameVariantService({ personId, variantId, requestedTreeId: treeId ?? null,
 requestedOwnerId: null, currentUserId });
  }
  async suggestFamily(params: SuggestFamilyParams): Promise<FamilySuggestion[]> {
    const currentUserId = await ensureLocalUser();
    return suggestFamilyService({
      lastName: params.lastName,
      birthDate: params.birthDate,
      sex: params.sex,
      birthPlace: params.birthPlace,
      requestedTreeId: params.treeId ?? null,
      requestedOwnerId: null,
      currentUserId,
    });
  }
  async descendantCount(personId: number, treeId?: number | null): Promise<number> {
    const currentUserId = await ensureLocalUser();
    return descendantCountService({ personId, requestedTreeId: treeId ?? null,
 requestedOwnerId: null, currentUserId });
  }
}
