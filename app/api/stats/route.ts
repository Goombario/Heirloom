import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { getTreeCountsService } from '@/lib/services/tree-counts';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const counts = await getTreeCountsService({
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        // Legacy response shape — this endpoint predates tree-counts and its
        // clients read *Count keys (shape unification is audit item N4/N5).
        return NextResponse.json({
            peopleCount: counts.people,
            familiesCount: counts.families,
            eventsCount: counts.events,
            mediaCount: counts.media,
        });
    } catch (error) {
        return handleApiError(error, 'Failed to fetch stats');
    }
}
