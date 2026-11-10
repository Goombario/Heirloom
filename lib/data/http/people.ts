import type {
  Audited, NameVariantDates,
  PeopleClient, GetPeopleOptions, GetPeopleResult, CreatePersonInput,
  UpdatePersonInput, NameVariant, CreateNameVariantInput, SuggestFamilyParams, FamilySuggestion,
} from '../types';
import type { Person, PersonWithRelations } from '@/lib/db/schema';
import type { PersonWithParentFamily } from '@/lib/db/queries/people';
import { auditIdsFrom, ensureAuditIds, throwForStatus, treeQuery } from './shared';
import type { PeopleFlag } from '@/lib/db/queries/data-quality';

/** People methods backed by the hosted REST API (`/api/people*`). */
export class HttpPeopleClient implements PeopleClient {
  async list(options: GetPeopleOptions = {}): Promise<GetPeopleResult> {
    const params = new URLSearchParams();
    if (options.treeId != null) params.set('treeId', String(options.treeId));
    if (options.search) params.set('q', options.search);
    const qs = params.toString();
    const res = await fetch(qs ? `/api/people?${qs}` : '/api/people');
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as GetPeopleResult;
  }

  async create(input: CreatePersonInput, options: { treeId?: number | null } = {}): Promise<Audited<Person>> {
    const qs = treeQuery(options.treeId);
    const res = await fetch(`/api/people${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) await throwForStatus(res);
    const data = (await res.json()) as { person: Audited<Person> };
    return ensureAuditIds(data.person);
  }

  async get(id: number, treeId?: number | null): Promise<PersonWithRelations> {
    const res = await fetch(`/api/people/${id}${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { person: PersonWithRelations }).person;
  }

  async update(id: number, patch: UpdatePersonInput, treeId?: number | null): Promise<Audited<Person>> {
    const res = await fetch(`/api/people/${id}${treeQuery(treeId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { person: Audited<Person> }).person);
  }

  async remove(id: number, treeId?: number | null): Promise<void> {
    const res = await fetch(`/api/people/${id}${treeQuery(treeId)}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
  }

  async search(q: string, treeId?: number | null, limit?: number, options?: { places?: boolean }): Promise<PersonWithParentFamily[]> {
    const params = new URLSearchParams({ q });
    if (treeId != null) params.set('treeId', String(treeId));
    if (limit != null) params.set('limit', String(limit));
    if (options?.places) params.set('places', '1');
    const res = await fetch(`/api/people/search?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { people: PersonWithParentFamily[] }).people;
  }

  async listFlagged(flag: PeopleFlag, treeId?: number | null): Promise<number[][]> {
    const params = new URLSearchParams({ filter: flag });
    if (treeId != null) params.set('treeId', String(treeId));
    const res = await fetch(`/api/people/flagged?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { groups: number[][] }).groups;
  }

  async listNameVariants(personId: number, treeId?: number | null): Promise<NameVariant[]> {
    const res = await fetch(`/api/people/${personId}/name-variants${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { variants: NameVariant[] }).variants;
  }

  async createNameVariant(personId: number, body: CreateNameVariantInput, treeId?: number | null): Promise<Audited<NameVariant>> {
    const res = await fetch(`/api/people/${personId}/name-variants${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { variant: Audited<NameVariant> }).variant);
  }

  async setPrimaryNameVariant(personId: number, variantId: number, isPrimary: boolean, treeId?: number | null): Promise<Audited<NameVariant>> {
    const res = await fetch(`/api/people/${personId}/name-variants/${variantId}${treeQuery(treeId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IsPrimary: isPrimary }),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { variant: Audited<NameVariant> }).variant);
  }

  async updateNameVariant(personId: number, variantId: number, name: string, treeId?: number | null, dates?: NameVariantDates & { Type?: string }): Promise<Audited<NameVariant>> {
    const res = await fetch(`/api/people/${personId}/name-variants/${variantId}${treeQuery(treeId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Name: name, ...dates }),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { variant: Audited<NameVariant> }).variant);
  }

  async removeNameVariant(personId: number, variantId: number, treeId?: number | null): Promise<Audited> {
    const res = await fetch(`/api/people/${personId}/name-variants/${variantId}${treeQuery(treeId)}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
    return auditIdsFrom(res);
  }

  async suggestFamily(params: SuggestFamilyParams): Promise<FamilySuggestion[]> {
    const qs = new URLSearchParams({ lastName: params.lastName, birthDate: params.birthDate });
    if (params.sex) qs.set('sex', params.sex);
    if (params.birthPlace) qs.set('birthPlace', params.birthPlace);
    if (params.treeId != null) qs.set('treeId', String(params.treeId));
    const res = await fetch(`/api/people/suggest-family?${qs.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { suggestions: FamilySuggestion[] }).suggestions;
  }

  async descendantCount(personId: number, treeId?: number | null): Promise<number> {
    const res = await fetch(`/api/people/${personId}/descendant-count${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { count: number }).count;
  }
}
