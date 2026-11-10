import type { RelationshipClient, RelationshipResult } from '../types';
import { getRelationshipService } from '@/lib/services/relationship';
import { ensureLocalUser } from '../local-user';

/**
 * Relationship method backed by in-browser PGlite.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree);
 * `requestedOwnerId` stays null (sharing is a hosted-only concept).
 */
export class LocalRelationshipClient implements RelationshipClient {
  async get(person1Id: number, person2Id: number, treeId?: number | null): Promise<RelationshipResult> {
    if (person1Id === person2Id) {
      return { relationship: 'Same person', path: [], degree: 0 };
    }
    const currentUserId = await ensureLocalUser();
    return getRelationshipService({ person1Id, person2Id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }
}
