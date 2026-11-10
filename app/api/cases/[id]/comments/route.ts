import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { addCommentService } from '@/lib/services/cases';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await params;
        const caseId = parseIdParam(id);
        if (caseId === null) return NextResponse.json({ error: 'Invalid case ID' }, { status: 400 });
        const body = await request.json();
        const mediaId = parseOptionalIdParam(body.mediaId != null ? String(body.mediaId) : null, 'mediaId');

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        const comment = await addCommentService({
            id: caseId,
            body: body.body,
            mediaId,
            requestedTreeId,
            requestedOwnerId,
            currentUserId: user.id,
        });
        return NextResponse.json({ comment }, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to add comment');
    }
}
