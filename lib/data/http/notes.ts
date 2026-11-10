import type { Audited, NotesClient } from '../types';
import type { Note, NoteOwnerFact } from '@/lib/db/queries/notes';
import type { LinkOwnerTable } from '@/lib/db/fact-tables';
import { auditIdsFrom, ensureAuditIds, throwForStatus, treeQuery } from './shared';

/**
 * Notes backed by the hosted REST API (`/api/notes`). `recordId` is the owner
 * record the note attaches to (the NoteLink owner); `treeId` is the tree scope,
 * per the app-wide query convention.
 */
export class HttpNotesClient implements NotesClient {
  async listForOwner(ownerTable: LinkOwnerTable, ownerId: number, treeId?: number | null): Promise<Note[]> {
    const qs = new URLSearchParams({ ownerTable, recordId: String(ownerId) });
    if (treeId != null) qs.set('treeId', String(treeId));
    const res = await fetch(`/api/notes?${qs.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { notes: Note[] }).notes;
  }

  async create(ownerTable: LinkOwnerTable, ownerId: number, text: string, treeId?: number | null, ownerFact?: NoteOwnerFact): Promise<Audited<Note>> {
    const res = await fetch(`/api/notes${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerTable, recordId: ownerId, text, ...(ownerFact !== undefined ? { ownerFact } : {}) }),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { note: Note }).note);
  }

  async update(id: number, ownerTable: LinkOwnerTable, ownerId: number, text: string, treeId?: number | null): Promise<Audited<Note>> {
    const qs = new URLSearchParams({ ownerTable, recordId: String(ownerId) });
    if (treeId != null) qs.set('treeId', String(treeId));
    const res = await fetch(`/api/notes/${id}?${qs.toString()}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) await throwForStatus(res);
    return ensureAuditIds(((await res.json()) as { note: Note }).note);
  }

  async remove(id: number, ownerTable: LinkOwnerTable, ownerId: number, treeId?: number | null): Promise<Audited> {
    const qs = new URLSearchParams({ ownerTable, recordId: String(ownerId) });
    if (treeId != null) qs.set('treeId', String(treeId));
    const res = await fetch(`/api/notes/${id}?${qs.toString()}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
    return auditIdsFrom(res);
  }

  async setPrimary(id: number, ownerTable: LinkOwnerTable, ownerId: number, isPrimary: boolean, treeId?: number | null): Promise<Audited> {
    const qs = new URLSearchParams({ ownerTable, recordId: String(ownerId) });
    if (treeId != null) qs.set('treeId', String(treeId));
    const res = await fetch(`/api/notes/${id}?${qs.toString()}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPrimary }),
    });
    if (!res.ok) await throwForStatus(res);
    return auditIdsFrom(res);
  }
}
