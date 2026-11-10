import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { confirmDataCheckService, reopenDataCheckService } from '@/lib/services/data-checks';

/** POST /api/data-checks/confirmations?treeId= { problemId, reason }: confirm an unlikely check (#830). */
export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const body = (await request.json().catch(() => null)) as { problemId?: unknown; reason?: unknown } | null;
        if (!body || typeof body !== 'object') {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const entry = await confirmDataCheckService({
            problemId: body.problemId,
            reason: body.reason,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json({ entry });
    } catch (error) {
        return handleApiError(error, 'Failed to confirm the check');
    }
}

/** DELETE /api/data-checks/confirmations?treeId=&problemId=: reopen a confirmed check (#830). */
export async function DELETE(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        await reopenDataCheckService({
            problemId: searchParams.get('problemId'),
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        return handleApiError(error, 'Failed to reopen the check');
    }
}
