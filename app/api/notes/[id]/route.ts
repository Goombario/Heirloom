import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { removeNoteService, updateNoteService, setPrimaryNoteService } from '@/lib/services/notes';

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
 * Mark this note as its owner's primary (preferred) one, or clear the owner's
 * primary when `isPrimary` is false. Separate from PUT because it changes the
 * NoteLink, not the note text (ADR 0010/0012).
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
