import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { listTagsService, createTagService } from '@/lib/services/media';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const mediaId = parseIdParam(id);
        if (mediaId === null) {
            return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        const tags = await listTagsService({ requestedTreeId, requestedOwnerId, currentUserId: user.id, mediaId });
        return NextResponse.json({ tags, count: tags.length });
    } catch (error) {
        return handleApiError(error, 'Failed to fetch media tags');
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const mediaId = parseIdParam(id);
        if (mediaId === null) {
            return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
        const body = await request.json();

        const tag = await createTagService({ requestedTreeId, requestedOwnerId, currentUserId: user.id, mediaId, body });
        return NextResponse.json({ tag }, { status: 201 });
    } catch (error) {
        // createTagService signals a bad media/person ref with this message; keep
        // it a 404 (handleApiError has no case for it and would 500).
        if (error instanceof Error && error.message.includes('not found in this tree')) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        return handleApiError(error, 'Failed to create media tag');
    }
}
