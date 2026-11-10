import type { RelationshipClient, RelationshipResult } from '../types';
import { throwForStatus } from './shared';

export class HttpRelationshipClient implements RelationshipClient {
  async get(person1Id: number, person2Id: number, treeId?: number | null): Promise<RelationshipResult> {
    const params = new URLSearchParams({ person1: String(person1Id), person2: String(person2Id) });
    if (treeId != null) params.set('treeId', String(treeId));
    const res = await fetch(`/api/relationship?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as RelationshipResult;
  }
}
