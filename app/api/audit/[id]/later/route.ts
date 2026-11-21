import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { listLaterChangesService } from '@/lib/services/audit';

/** What reverting a person merge undoes too (#28), for the Revert confirmation. */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const entryId = parseIdParam(id);
    if (entryId === null) return NextResponse.json({ error: 'Invalid audit entry ID' }, { status: 400 });

    const { searchParams } = new URL(request.url);
    try {
        const entries = await listLaterChangesService({
            id: entryId,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json({ entries });
    } catch (error) {
        return handleApiError(error, 'Failed to list later changes');
    }
}
