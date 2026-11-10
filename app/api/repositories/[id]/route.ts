import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { getRepositoryService, updateRepositoryService, removeRepositoryService } from '@/lib/services/repositories';
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
        const repository = await getRepositoryService({ id: repoId, requestedTreeId, requestedOwnerId, currentUserId: user.id });
        return NextResponse.json({ repository });
    } catch (error) {
        return handleApiError(error, 'Failed to fetch repository');
    }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await params;
        const repoId = parseIdParam(id);
        if (repoId === null) return NextResponse.json({ error: 'Invalid repository ID' }, { status: 400 });

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
        const body = await request.json();
        const repository = await updateRepositoryService({ id: repoId, body, requestedTreeId, requestedOwnerId, currentUserId: user.id });
        return NextResponse.json({ repository });
    } catch (error) {
        return handleApiError(error, 'Failed to update repository');
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await params;
        const repoId = parseIdParam(id);
        if (repoId === null) return NextResponse.json({ error: 'Invalid repository ID' }, { status: 400 });

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
        await removeRepositoryService({ id: repoId, requestedTreeId, requestedOwnerId, currentUserId: user.id });
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        return handleApiError(error, 'Failed to delete repository');
    }
}
