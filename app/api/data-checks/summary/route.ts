import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { summarizeDataChecksService } from '@/lib/services/data-checks';

/** GET /api/data-checks/summary?treeId=: the count still to check and the first few entries (#1270). */
export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const summary = await summarizeDataChecksService({
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json(summary);
    } catch (error) {
        return handleApiError(error, 'Failed to run data checks');
    }
}
