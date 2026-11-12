import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { removeNoteService, updateNoteService, setPrimaryNoteService, moveNoteService } from '@/lib/services/notes';
import type { NoteOwnerFact } from '@/lib/db/queries/notes';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const noteId = parseIdParam(id);
  if (noteId === null) return NextResponse.json({ error: 'Invalid note id' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
  const ownerTable = searchParams.get('ownerTable');
  const recordId = parseIdParam(searchParams.get('recordId'));

  if (!ownerTable || recordId === null) {
    return NextResponse.json({ error: 'ownerTable and recordId are required' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));

  try {
    const note = await updateNoteService({
      id: noteId,
      ownerTable,
      ownerId: recordId,
      text: typeof body.text === 'string' ? body.text : '',
      requestedTreeId,
      requestedOwnerId,
      currentUserId: user.id,
    });
    return NextResponse.json({ note });
  } catch (error) {
    return handleApiError(error, 'Failed to update note');
  }
}

/**
 * Change this note's link, not its text (ADR 0010/0012). `{ isPrimary }` marks it
 * as its owner's primary (preferred) one, or clears the owner's primary when false.
 * `{ ownerFact, moveTo: { ownerTable, recordId, ownerFact } }` moves the link from
 * this owner (and fact) to another record or fact it is about (ADR 0043).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const noteId = parseIdParam(id);
  if (noteId === null) return NextResponse.json({ error: 'Invalid note id' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
  const ownerTable = searchParams.get('ownerTable');
  const recordId = parseIdParam(searchParams.get('recordId'));

  if (!ownerTable || recordId === null) {
    return NextResponse.json({ error: 'ownerTable and recordId are required' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  if (body.moveTo !== undefined) {
    const to = body.moveTo as { ownerTable?: unknown; recordId?: unknown; ownerFact?: unknown } | null;
    const toRecordId = typeof to?.recordId === 'number' && Number.isInteger(to.recordId) ? to.recordId : null;
    const fact = (v: unknown) => (v == null ? null : typeof v === 'string' ? v as NoteOwnerFact : undefined);
    const fromFact = fact(body.ownerFact);
    const toFact = fact(to?.ownerFact);
    if (!to || typeof to.ownerTable !== 'string' || toRecordId === null || fromFact === undefined || toFact === undefined) {
      return NextResponse.json({ error: 'moveTo needs ownerTable, recordId and ownerFact' }, { status: 400 });
    }
    try {
      const { auditIds } = await moveNoteService({
        id: noteId,
        from: { ownerTable, ownerId: recordId, ownerFact: fromFact },
        to: { ownerTable: to.ownerTable, ownerId: toRecordId, ownerFact: toFact },
        requestedTreeId,
        requestedOwnerId,
        currentUserId: user.id,
      });
      return NextResponse.json({ auditIds });
    } catch (error) {
      return handleApiError(error, 'Failed to move note');
    }
  }
  if (typeof body.isPrimary !== 'boolean') {
    return NextResponse.json({ error: 'isPrimary (boolean) is required' }, { status: 400 });
  }

  try {
    const { auditIds } = await setPrimaryNoteService({
      // Clearing is owner-scoped, so it passes null rather than this note's id.
      id: body.isPrimary ? noteId : null,
      ownerTable,
      ownerId: recordId,
      requestedTreeId,
      requestedOwnerId,
      currentUserId: user.id,
    });
    return NextResponse.json({ auditIds });
  } catch (error) {
    return handleApiError(error, 'Failed to update primary note');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const noteId = parseIdParam(id);
  if (noteId === null) return NextResponse.json({ error: 'Invalid note id' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
  const ownerTable = searchParams.get('ownerTable');
  const recordId = parseIdParam(searchParams.get('recordId'));

  if (!ownerTable || recordId === null) {
    return NextResponse.json({ error: 'ownerTable and recordId are required' }, { status: 400 });
  }

  try {
    const { auditIds } = await removeNoteService({
      id: noteId,
      ownerTable,
      ownerId: recordId,
      requestedTreeId,
      requestedOwnerId,
      currentUserId: user.id,
    });
    return NextResponse.json({ auditIds });
  } catch (error) {
    return handleApiError(error, 'Failed to delete note');
  }
}
