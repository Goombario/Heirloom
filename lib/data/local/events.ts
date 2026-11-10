import type { Audited, EventsClient, EventInput } from '../types';
import type { GedcomEvent } from '@/lib/db/schema';
import { createEventService, updateEventService, deleteEventService } from '@/lib/services/events';
import { ensureLocalUser } from '../local-user';

/**
 * Events methods backed by in-browser PGlite.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree);
 * `requestedOwnerId` stays null (sharing is a hosted-only concept).
 */
export class LocalEventsClient implements EventsClient {
  async create(input: EventInput, treeId?: number | null): Promise<Audited<GedcomEvent>> {
    const currentUserId = await ensureLocalUser();
    return createEventService({ body: input, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async update(id: number, patch: Partial<EventInput>, treeId?: number | null): Promise<Audited<GedcomEvent>> {
    const currentUserId = await ensureLocalUser();
    return updateEventService({ eventId: id, body: patch, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async remove(id: number, treeId?: number | null): Promise<Audited> {
    const currentUserId = await ensureLocalUser();
    const { auditIds } = await deleteEventService({ eventId: id, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
    return { auditIds };
  }
}
