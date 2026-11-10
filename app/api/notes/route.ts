import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { listNotesForOwnerService, createNoteForOwnerService } from '@/lib/services/notes';
import type { NoteOwnerFact } from '@/lib/db/queries/notes';

// `ownerId` (query) is the tree owner for shared-tree access; `recordId` is the
// owner record the note attaches to (the NoteLink owner) — kept distinct so the
// two ids don't collide in the query string.

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
  const ownerTable = searchParams.get('ownerTable');
  const recordId = parseIdParam(searchParams.get('recordId'));

  if (!ownerTable || recordId === null) {
    return NextResponse.json({ error: 'ownerTable and recordId are required' }, { status: 400 });
  }

  try {
    const notes = await listNotesForOwnerService({
      ownerTable,
      ownerId: recordId,
      requestedTreeId,
      requestedOwnerId,
      currentUserId: user.id,
    });
    return NextResponse.json({ notes, count: notes.length });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch notes');
  }
}

export async function POST(request: NextRequest) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

  let body: { ownerTable?: string; recordId?: unknown; text?: unknown; ownerFact?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const recordId = parseIdParam(body.recordId != null ? String(body.recordId) : null);
  if (recordId === null) {
    return NextResponse.json({ error: 'Invalid recordId' }, { status: 400 });
  }

  try {
    const note = await createNoteForOwnerService({
      ownerTable: body.ownerTable ?? '',
      ownerId: recordId,
      text: typeof body.text === 'string' ? body.text : '',
      ownerFact: typeof body.ownerFact === 'string' ? (body.ownerFact as NoteOwnerFact) : undefined,
      requestedTreeId,
      requestedOwnerId,
      currentUserId: user.id,
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to create note');
  }
}
