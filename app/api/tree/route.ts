import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { getTreeService } from '@/lib/services/tree';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        // Invalid/garbage id falls back to the default root rather than 400:
        // the tree client forwards ?rootId= / localStorage values unvalidated
        // (a stale 'selectedRootPerson' can serialize as ?id=NaN), and the old
        // behavior — matched by the static/PGlite build — was a graceful
        // default-tree render, not an error page.
        const id = parseIdParam(searchParams.get('id'));

        const treeData = await getTreeService({
            id,
            mode: searchParams.get('mode') || 'descendants',
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        return NextResponse.json(treeData);
    } catch (error) {
        return handleApiError(error, 'Failed to fetch tree data');
    }
}
