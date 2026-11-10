import { NextRequest, NextResponse } from 'next/server';
import { getMediaById } from '@/lib/db/queries/media';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { deleteMediaService, updateMediaService } from '@/lib/services/media';
import { unlinkMediaForOwnerService } from '@/lib/services/media-links';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

function parseStrictMediaId(value: string): number | null {
    if (!/^[1-9]\d*$/.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
}

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
        const mediaId = parseStrictMediaId(id);

        if (mediaId === null) {
            return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const scope = await resolveTreeScope(
            { treeId: parseIdParam(searchParams.get('treeId')), ownerId: parseIdParam(searchParams.get('ownerId')) },
            user.id
        );

        const media = await getMediaById(mediaId, scope.treeId);

        if (!media) {
            return NextResponse.json({ error: 'Media not found' }, { status: 404 });
        }

        return NextResponse.json({ media });
    } catch (error) {
        return handleApiError(error, 'Failed to fetch media');
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const mediaId = parseStrictMediaId(id);

        if (mediaId === null) {
            return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
        const body = await request.json();

        const media = await updateMediaService({
            requestedTreeId, requestedOwnerId, currentUserId: user.id, id: mediaId, body,
        });
        return NextResponse.json({ media });
    } catch (error) {
        return handleApiError(error, 'Failed to update media');
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const mediaId = parseStrictMediaId(id);

        if (mediaId === null) {
            return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        // Detach from a single owner (family/source/…) rather than a full delete.
        // Allowed for contributors too, but only owner/edit orphan-delete the now
        // unreferenced media row — a contributor unlinks only (see the service).
        const ownerTable = searchParams.get('ownerTable');
        if (ownerTable) {
            // Present ownerTable with a malformed recordId → 400, not a fall-through
            // to the full-delete path below.
            const recordId = parseIdParam(searchParams.get('recordId'));
            if (recordId === null) {
                return NextResponse.json({ error: 'Invalid recordId' }, { status: 400 });
            }
            try {
                await unlinkMediaForOwnerService({
                    mediaId, ownerTable, ownerId: recordId, ownerFact: searchParams.get('ownerFact'),
                    requestedTreeId, requestedOwnerId, currentUserId: user.id,
                });
                return new NextResponse(null, { status: 204 });
            } catch (error) {
                return handleApiError(error, 'Failed to unlink media');
            }
        }

        const success = await deleteMediaService({
            requestedTreeId,
            requestedOwnerId,
            currentUserId: user.id,
            id: mediaId,
        });

        if (!success) {
            return NextResponse.json({ error: 'Media not found' }, { status: 404 });
        }

        return new NextResponse(null, { status: 204 });
    } catch (error) {
        return handleApiError(error, 'Failed to delete media');
    }
}
