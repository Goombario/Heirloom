import type { Audited, EventsClient, EventInput } from '../types';
import type { GedcomEvent } from '@/lib/db/schema';
import type { EventTypeCount } from '@/lib/events/custom-types';
import { auditIdsFrom, ensureAuditIds, throwForStatus, treeQuery } from './shared';

/** Events methods backed by the hosted REST API (`/api/events`). */
export class HttpEventsClient implements EventsClient {
  async create(input: EventInput, treeId?: number | null): Promise<Audited<GedcomEvent>> {
    const res = await fetch(`/api/events${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { event: Audited<GedcomEvent> }).event);
  }

  async update(id: number, patch: Partial<EventInput>, treeId?: number | null): Promise<Audited<GedcomEvent>> {
    const res = await fetch(`/api/events/${id}${treeQuery(treeId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { event: Audited<GedcomEvent> }).event);
  }

  async remove(id: number, treeId?: number | null): Promise<Audited> {
    const res = await fetch(`/api/events/${id}${treeQuery(treeId)}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
    return auditIdsFrom(res);
  }

  async listTypeCounts(treeId?: number | null): Promise<EventTypeCount[]> {
    const res = await fetch(`/api/events/types${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { types: EventTypeCount[] }).types;
  }
}
