import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { listFaceQueueService } from '@/lib/services/media-faces';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const result = await listFaceQueueService({
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
            resolved: searchParams.get('resolved') === 'true',
            countOnly: searchParams.get('countOnly') === 'true',
            mediaId: parseIdParam(searchParams.get('mediaId')) ?? undefined,
        });
        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to load the face queue');
    }
}
