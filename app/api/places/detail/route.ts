import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { deletePlaceService, getPlaceDetailService } from '@/lib/services/places';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const placeName = searchParams.get('name');
        const placeId = parseOptionalIdParam(searchParams.get('id'), 'id');
        if (!placeName && placeId == null) return NextResponse.json({ error: 'name or id is required' }, { status: 400 });

        const result = await getPlaceDetailService({
            name: placeName ?? undefined,
            id: placeId,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to fetch place');
    }
}

/** DELETE /api/places/detail?id= — delete a place nothing uses (#1229). */
export async function DELETE(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const placeId = parseIdParam(searchParams.get('id'));
        if (placeId === null) return NextResponse.json({ error: 'id must be a place id' }, { status: 400 });

        const result = await deletePlaceService({
            placeId,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to delete place');
    }
}
