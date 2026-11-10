import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { descendantCountService } from '@/lib/services/people';
import { handleApiError } from '@/lib/api/handle-error';

/**
 * Total descendants of a person, all generations — one integer.
 *
 * Separate from `/api/tree?mode=descendants` on purpose: the person hero labels
 * its Descendants button on every view, and the tree endpoint returns the whole
 * tree (tens of KB) to answer the same question.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const personId = parseIdParam(id);
    if (personId === null) return NextResponse.json({ error: 'Invalid person ID' }, { status: 400 });

    const { searchParams } = new URL(request.url);
    try {
        const count = await descendantCountService({
            personId,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json({ count });
    } catch (error) {
        return handleApiError(error, 'Failed to count descendants');
    }
}
