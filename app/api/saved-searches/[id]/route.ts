import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { deleteSavedSearchService } from '@/lib/services/advanced-search';

/** Delete one of the member's own saved searches (#247). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const id = parseIdParam((await params).id);
        if (id === null) return NextResponse.json({ error: 'A saved search id is required' }, { status: 400 });
        const { searchParams } = new URL(request.url);
        await deleteSavedSearchService({
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
            id,
        });
        return NextResponse.json({ ok: true });
    } catch (error) {
        return handleApiError(error, 'Failed to delete the saved search');
    }
}
