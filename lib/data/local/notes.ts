import type { Audited, NotesClient } from '../types';
import type { Note, NoteOwnerFact } from '@/lib/db/queries/notes';
import type { LinkOwnerTable } from '@/lib/db/fact-tables';
import {
  listNotesForOwnerService,
  createNoteForOwnerService,
  updateNoteService,
  removeNoteService,
  setPrimaryNoteService,
} from '@/lib/services/notes';
import { ensureLocalUser } from '../local-user';

/**
 * Notes methods backed by in-browser PGlite.
 * Tree scope passes through as `requestedTreeId` (the local build is multi-tree);
 * `requestedOwnerId` stays null (sharing is a hosted-only concept).
 */
export class LocalNotesClient implements NotesClient {
  async listForOwner(ownerTable: LinkOwnerTable, ownerId: number, treeId?: number | null): Promise<Note[]> {
    const currentUserId = await ensureLocalUser();
    return listNotesForOwnerService({ ownerTable, ownerId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async create(ownerTable: LinkOwnerTable, ownerId: number, text: string, treeId?: number | null, ownerFact?: NoteOwnerFact): Promise<Audited<Note>> {
    const currentUserId = await ensureLocalUser();
    return createNoteForOwnerService({ ownerTable, ownerId, text, ownerFact, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async update(id: number, ownerTable: LinkOwnerTable, ownerId: number, text: string, treeId?: number | null): Promise<Audited<Note>> {
    const currentUserId = await ensureLocalUser();
    return updateNoteService({ id, ownerTable, ownerId, text, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async remove(id: number, ownerTable: LinkOwnerTable, ownerId: number, treeId?: number | null): Promise<Audited> {
    const currentUserId = await ensureLocalUser();
    return removeNoteService({ id, ownerTable, ownerId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async setPrimary(id: number, ownerTable: LinkOwnerTable, ownerId: number, isPrimary: boolean, treeId?: number | null): Promise<Audited> {
    const currentUserId = await ensureLocalUser();
    // Clearing is owner-scoped, so it passes null rather than this note's id.
    return setPrimaryNoteService({ id: isPrimary ? id : null, ownerTable, ownerId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }
}
