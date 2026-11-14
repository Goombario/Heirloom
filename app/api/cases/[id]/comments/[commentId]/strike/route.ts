import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { strikeCaseNoteService, unstrikeCaseNoteService } from '@/lib/services/cases';

type Params = { params: Promise<{ id: string; commentId: string }> };

/** The note a request names, and its tree scope; null when an id is malformed. */
async function target(request: NextRequest, { params }: Params) {
    const { id, commentId } = await params;
    const caseId = parseIdParam(id);
    const noteId = parseIdParam(commentId);
    if (caseId === null || noteId === null) return null;
    const { searchParams } = new URL(request.url);
    return {
        caseId,
        commentId: noteId,
        requestedTreeId: parseIdParam(searchParams.get('treeId')),
        requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
    };
}

/**
 * POST /api/cases/[id]/comments/[commentId]/strike — strike a journal note out as
 * no longer accurate, with an optional `reason` (#1251). Entries are never edited
 * or deleted (ADR 0042).
 */
export async function POST(request: NextRequest, context: Params) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const note = await target(request, context);
        if (!note) return NextResponse.json({ error: 'Invalid case or note ID' }, { status: 400 });
        const body = await readJsonObject(request).catch(() => ({}));
        const result = await strikeCaseNoteService({ ...note, reason: body?.reason, currentUserId: user.id });
        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to strike out note');
    }
}

/** DELETE /api/cases/[id]/comments/[commentId]/strike — undo a strike-out (#1251). */
export async function DELETE(request: NextRequest, context: Params) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const note = await target(request, context);
        if (!note) return NextResponse.json({ error: 'Invalid case or note ID' }, { status: 400 });
        const result = await unstrikeCaseNoteService({ ...note, currentUserId: user.id });
        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to undo strike-out');
    }
}
