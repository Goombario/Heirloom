import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { getFamilyService, updateFamilyService, deleteFamilyService } from '@/lib/services/families';
import { handleApiError } from '@/lib/api/handle-error';
import { AccessError, NotFoundError } from '@/lib/data/errors';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await params;
        const familyId = parseIdParam(id);
        if (familyId === null) return NextResponse.json({ error: 'Invalid family ID' }, { status: 400 });

        const { searchParams } = new URL(request.url);
        const detail = await getFamilyService({
            id: familyId,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        // The whole detail: picking fields here dropped `marriageMedia` (#905) in hosted mode.
        return NextResponse.json(detail);
    } catch (error) {
        if (error instanceof NotFoundError) {
            return NextResponse.json({ error: 'Family not found' }, { status: 404 });
        }
        if (error instanceof AccessError || (error instanceof Error && error.message.includes('Access denied'))) {
            return NextResponse.json({ error: (error as Error).message }, { status: 403 });
        }
        console.error('Error fetching family:', error);
        return NextResponse.json({ error: 'Failed to fetch family' }, { status: 500 });
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await params;
        const familyId = parseIdParam(id);
        if (familyId === null) return NextResponse.json({ error: 'Invalid family ID' }, { status: 400 });

        const { searchParams } = new URL(request.url);
        const body = await request.json();

        const family = await updateFamilyService({
            id: familyId,
            body,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        return NextResponse.json({ family });
    } catch (error) {
        return handleApiError(error, 'Failed to update family');
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await params;
        const familyId = parseIdParam(id);
        if (familyId === null) return NextResponse.json({ error: 'Invalid family ID' }, { status: 400 });

        const { searchParams } = new URL(request.url);
        const { auditId } = await deleteFamilyService({
            id: familyId,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        // The audit entry's Id lets the UI offer Undo through the audit revert (#788).
        return NextResponse.json({ auditId });
    } catch (error) {
        if (error instanceof NotFoundError) {
            return NextResponse.json({ error: 'Family not found' }, { status: 404 });
        }
        if (error instanceof AccessError || (error instanceof Error && error.message.includes('Access denied'))) {
            return NextResponse.json({ error: (error as Error).message }, { status: 403 });
        }
        console.error('Error deleting family:', error);
        return NextResponse.json({ error: 'Failed to delete family' }, { status: 500 });
    }
}
