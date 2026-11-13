import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { listRepositoriesService, createRepositoryService } from '@/lib/services/repositories';
import { handleApiError } from '@/lib/api/handle-error';
import { parseIdParam } from '@/lib/utils/parse-id';

export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        const repositories = await listRepositoriesService({ requestedTreeId, requestedOwnerId, currentUserId: user.id });
        return NextResponse.json({ repositories, count: repositories.length });
    } catch (error) {
        return handleApiError(error, 'Failed to fetch repositories');
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
        const body = await readJsonObject(request).catch(() => ({}));

        const repository = await createRepositoryService({ body, requestedTreeId, requestedOwnerId, currentUserId: user.id });
        return NextResponse.json({ repository }, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to create repository');
    }
}
