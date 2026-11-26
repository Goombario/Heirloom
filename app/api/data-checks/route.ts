import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { listDataChecksService } from '@/lib/services/data-checks';

export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        const result = await listDataChecksService({
            requestedTreeId,
            requestedOwnerId,
            personId: parseIdParam(searchParams.get('personId')),
            familyId: parseIdParam(searchParams.get('familyId')),
            currentUserId: user.id,
        });
        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to run data checks');
    }
}
