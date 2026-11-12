import {
  getNotesForOwner,
  createNoteForOwner,
  updateNote,
  unlinkNote,
  setPrimaryNoteForOwner,
  getNoteAuditSnapshot,
  moveNoteLink,
  NOTE_OWNER_FACTS,
  type Note,
  type NoteOwnerFact,
} from '@/lib/db/queries/notes';
import { auditNote, withAuditIds, type Audited } from '@/lib/db/queries/audit-capture';
import type { LinkOwnerTable } from '@/lib/db/fact-tables';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import { getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import { validatedOwner, assertOwnerInTree } from '@/lib/services/owner-links';

export interface ListNotesParams {
  ownerTable: string;
  ownerId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/notes logic: validate access, then list notes attached to one owner record. */
export async function listNotesForOwnerService(params: ListNotesParams): Promise<Note[]> {
  const { ownerTable, ownerId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const table = validatedOwner(ownerTable, ownerId);
  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  return getNotesForOwner(table, ownerId, scope.treeId);
}

export interface CreateNoteParams {
  ownerTable: string;
  ownerId: number;
  text: string;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
  /** Which promoted vital fact this note is about (set from context; moving it later is `moveNoteService`, ADR 0043). */
  ownerFact?: NoteOwnerFact;
}

/** POST /api/notes logic: check write permission, validate, IDOR-guard the owner, then create + link. */
export async function createNoteForOwnerService(params: CreateNoteParams): Promise<Audited<Note>> {
  const { ownerTable, ownerId, text, requestedTreeId, requestedOwnerId, currentUserId, ownerFact } = params;
  const table = validatedOwner(ownerTable, ownerId);

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }

  const trimmed = (text ?? '').trim();
  if (!trimmed) throw new ValidationError('Note text is required');

  if (ownerFact != null && !NOTE_OWNER_FACTS.includes(ownerFact)) {
    throw new ValidationError('Invalid note scope');
  }

  await assertOwnerInTree(table, ownerId, scope.treeId);
  const note = await createNoteForOwner(table, ownerId, trimmed, scope.ownerId, scope.treeId, undefined, ownerFact ?? null, true);
  const snapshot = await getNoteAuditSnapshot(note.Id, table, ownerId, scope.treeId);
  const auditId = snapshot ? await auditNote('create', snapshot, scope.ownerId, currentUserId) : null;
  return withAuditIds(note, [auditId]);
}

export interface UpdateNoteParams {
  id: number;
  ownerTable: string;
  ownerId: number;
  text: string;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** PUT /api/notes/[id] logic: check write permission, validate, then update the note's text. */
export async function updateNoteService(params: UpdateNoteParams): Promise<Audited<Note>> {
  const { id, ownerTable, ownerId, text, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const table = validatedOwner(ownerTable, ownerId);

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }

  const trimmed = (text ?? '').trim();
  if (!trimmed) throw new ValidationError('Note text is required');

  const before = await getNoteAuditSnapshot(id, table, ownerId, scope.treeId);
  if (!before) throw new NotFoundError('Note not found');
  // Saving the same text is not an edit: UpdatedAt and the log stay as they were.
  if (before.Text === trimmed) {
    const unchanged = (await getNotesForOwner(table, ownerId, scope.treeId)).find((n) => n.Id === id);
    if (unchanged) return withAuditIds(unchanged, []);
  }

  const updated = await updateNote(id, table, ownerId, trimmed, scope.treeId);
  if (!updated) throw new NotFoundError('Note not found');
  const auditId = await auditNote(
    'update',
    { ...before, Text: trimmed, UpdatedAt: stamp(updated.UpdatedAt) },
    scope.ownerId,
    currentUserId,
    { Text: { old: before.Text, new: trimmed } },
  );
  return withAuditIds(updated, [auditId]);
}

function stamp(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Audit each note whose preferred flag on this record flipped, one entry per note. */
async function auditPrimaryChanges(
  noteIds: number[],
  from: number,
  to: number,
  table: LinkOwnerTable,
  ownerId: number,
  treeId: number,
  treeOwnerId: number,
  userId: number,
): Promise<(number | null)[]> {
  const ids: (number | null)[] = [];
  for (const noteId of noteIds) {
    const snapshot = await getNoteAuditSnapshot(noteId, table, ownerId, treeId);
    if (!snapshot) continue;
    ids.push(await auditNote('update', snapshot, treeOwnerId, userId, { IsPrimary: { old: from, new: to } }));
  }
  return ids;
}

export interface SetPrimaryNoteParams {
  /** The note to promote, or null to clear the owner's primary entirely. */
  id: number | null;
  ownerTable: string;
  ownerId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/**
 * Mark one of an owner's notes as its primary (preferred) one — what a detail
 * page's hero slot shows. Write permission required; the flag lives on the
 * NoteLink, so promoting a shared note affects only THIS owner (ADR 0010/0012).
 */
export async function setPrimaryNoteService(params: SetPrimaryNoteParams): Promise<Audited> {
  const { id, ownerTable, ownerId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const table = validatedOwner(ownerTable, ownerId);

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }
  await assertOwnerInTree(table, ownerId, scope.treeId);

  const changed = await setPrimaryNoteForOwner(id, table, ownerId, scope.treeId);
  if (!changed) throw new NotFoundError('Note not found');
  // Demotions are logged first, so a batch revert (newest first) restores the
  // promotion's flag before it puts the old preferred note back.
  const auditIds = [
    ...await auditPrimaryChanges(changed.demoted, 1, 0, table, ownerId, scope.treeId, scope.ownerId, currentUserId),
    ...await auditPrimaryChanges(changed.promoted, 0, 1, table, ownerId, scope.treeId, scope.ownerId, currentUserId),
  ];
  return withAuditIds({}, auditIds);
}

export interface RemoveNoteParams {
  id: number;
  ownerTable: string;
  ownerId: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** DELETE /api/notes/[id] logic: deletes need owner/edit — unlinkNote hard-deletes
 *  the orphaned Note row (content is destroyed, not just the link), so 'contribute'
 *  is blocked like every other destructive path. */
export async function removeNoteService(params: RemoveNoteParams): Promise<Audited> {
  const { id, ownerTable, ownerId, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const table = validatedOwner(ownerTable, ownerId);

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view' || scope.permission === 'contribute') {
    throw new AccessError('You do not have permission to delete records in this tree');
  }

  const before = await getNoteAuditSnapshot(id, table, ownerId, scope.treeId);
  const removed = before ? await unlinkNote(id, table, ownerId, scope.treeId) : false;
  if (!before || !removed) throw new NotFoundError('Note not found');
  return withAuditIds({}, [await auditNote('delete', before, scope.ownerId, currentUserId)]);
}

/** One end of a note move, as a caller names it (untrusted until validated). */
interface NoteMoveEnd {
  ownerTable: string;
  ownerId: number;
  ownerFact: NoteOwnerFact | null;
}

export interface MoveNoteParams {
  id: number;
  from: NoteMoveEnd;
  to: NoteMoveEnd;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

function validatedEnd(end: NoteMoveEnd) {
  const ownerTable = validatedOwner(end.ownerTable, end.ownerId);
  const ownerFact = end.ownerFact ?? null;
  if (ownerFact != null && !NOTE_OWNER_FACTS.includes(ownerFact)) throw new ValidationError('Invalid note scope');
  // A fact is a promoted vital on a person or family; an event is its own fact.
  if (ownerFact != null && ownerTable !== 'People' && ownerTable !== 'Families') throw new ValidationError('Invalid note scope');
  return { ownerTable, ownerId: end.ownerId, ownerFact };
}

/**
 * Move a note to another thing it is about (ADR 0043, superseding ADR 0016
 * decision 3): from the person in general to their birth, or to one of their
 * events, and back. The note keeps its text and history; only its link moves.
 * A move needs write permission, like editing the text, since nothing is
 * destroyed. Logged so Undo can put it back: on the same record as an update of
 * the link's `OwnerFact`; across records as a link added there and a link
 * removed here, in that order, so a revert never leaves the note without a link.
 */
export async function moveNoteService(params: MoveNoteParams): Promise<Audited> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const from = validatedEnd(params.from);
  const to = validatedEnd(params.to);
  const sameRecord = from.ownerTable === to.ownerTable && from.ownerId === to.ownerId;
  if (sameRecord && from.ownerFact === to.ownerFact) return withAuditIds({}, []);

  const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId);
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }
  await assertOwnerInTree(from.ownerTable, from.ownerId, scope.treeId);
  await assertOwnerInTree(to.ownerTable, to.ownerId, scope.treeId);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const before = await getNoteAuditSnapshot(id, from.ownerTable, from.ownerId, scope.treeId, client);
    if (!before || !before.Links.some((l) => l.OwnerFact === from.ownerFact)) throw new NotFoundError('Note not found');
    // A note linked twice to one record (under two facts, #512) can't move one of
    // the two across records: Undo restores a record's links as a set.
    if (!sameRecord && before.Links.length > 1) throw new ValidationError('This note is linked here more than once');
    const target = sameRecord ? before : await getNoteAuditSnapshot(id, to.ownerTable, to.ownerId, scope.treeId, client);
    if (sameRecord ? before.Links.some((l) => l.OwnerFact === to.ownerFact) : target) {
      throw new ValidationError('The note is already there');
    }

    const moved = await moveNoteLink(id, from, to, scope.treeId, client);
    if (!moved) throw new NotFoundError('Note not found');

    const auditIds: (number | null)[] = [];
    if (sameRecord) {
      const after = await getNoteAuditSnapshot(id, to.ownerTable, to.ownerId, scope.treeId, client);
      if (after) {
        auditIds.push(await auditNote('update', after, scope.ownerId, currentUserId, {
          OwnerFact: { old: from.ownerFact, new: to.ownerFact },
        }, client));
      }
    } else {
      const added = await getNoteAuditSnapshot(id, to.ownerTable, to.ownerId, scope.treeId, client);
      if (added) auditIds.push(await auditNote('create', added, scope.ownerId, currentUserId, undefined, client));
      auditIds.push(await auditNote('delete', before, scope.ownerId, currentUserId, undefined, client));
    }
    await client.query('COMMIT');
    return withAuditIds({}, auditIds);
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
}
