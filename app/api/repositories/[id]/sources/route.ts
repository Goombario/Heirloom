import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { listSourcesForRepositoryService } from '@/lib/services/repositories';
import { handleApiError } from '@/lib/api/handle-error';
import { parseIdParam } from '@/lib/utils/parse-id';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await params;
        const repoId = parseIdParam(id);
        if (repoId === null) return NextResponse.json({ error: 'Invalid repository ID' }, { status: 400 });

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
        const sources = await listSourcesForRepositoryService({ id: repoId, requestedTreeId, requestedOwnerId, currentUserId: user.id });
        return NextResponse.json({ sources, count: sources.length });
    } catch (error) {
        return handleApiError(error, 'Failed to fetch repository sources');
    }
}
