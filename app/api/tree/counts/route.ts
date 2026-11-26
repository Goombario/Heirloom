import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { getTreeCountsService } from '@/lib/services/tree-counts';

export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        const counts = await getTreeCountsService({ requestedTreeId, requestedOwnerId, currentUserId: user.id });
        return NextResponse.json(counts);
    } catch (error) {
        return handleApiError(error, 'Failed to fetch tree counts');
    }
}
