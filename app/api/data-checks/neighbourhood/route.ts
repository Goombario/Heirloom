import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { dataCheckNeighbourhoodService } from '@/lib/services/data-checks';

/** GET /api/data-checks/neighbourhood?personId=&treeId=: the dates one person's problems depend on (#832). */
export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const input = await dataCheckNeighbourhoodService({
            personId: parseIdParam(searchParams.get('personId')),
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json({ neighbourhood: input });
    } catch (error) {
        return handleApiError(error, 'Failed to load the dates to check');
    }
}
