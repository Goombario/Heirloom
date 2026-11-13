import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { updateTagService, removeTagService } from '@/lib/services/media';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; tagId: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id: mediaIdStr, tagId } = await params;
        const mediaId = parseIdParam(mediaIdStr);
        if (mediaId === null) {
            return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });
        }
        const id = parseIdParam(tagId);
        if (id === null) {
            return NextResponse.json({ error: 'Invalid tag ID' }, { status: 400 });
        }

        const body = await readJsonObject(request);
        const { searchParams } = new URL(request.url);
        const tag = await updateTagService({
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
            tagId: id,
            mediaId,
            body,
        });
        return NextResponse.json({ tag });
    } catch (error) {
        return handleApiError(error, 'Failed to update media tag');
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; tagId: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id: mediaIdStr, tagId } = await params;
        const mediaId = parseIdParam(mediaIdStr);
        if (mediaId === null) {
            return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });
        }
        const id = parseIdParam(tagId);
        if (id === null) {
            return NextResponse.json({ error: 'Invalid tag ID' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        await removeTagService({ requestedTreeId, requestedOwnerId, currentUserId: user.id, mediaId, tagId: id });
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        return handleApiError(error, 'Failed to delete media tag');
    }
}
