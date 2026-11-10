import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { searchFamiliesService } from '@/lib/services/families';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(request: NextRequest) {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    if (!q) return NextResponse.json({ error: 'Query parameter required' }, { status: 400 });

    try {
        const families = await searchFamiliesService({
            q,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json({ families });
    } catch (error) {
        return handleApiError(error, 'Failed to search families');
    }
}
