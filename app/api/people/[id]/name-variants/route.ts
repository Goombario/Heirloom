import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { listNameVariantsService, createNameVariantService } from '@/lib/services/people';
import { handleApiError } from '@/lib/api/handle-error';

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
        const variants = await listNameVariantsService({
            personId,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json({ variants, count: variants.length });
    } catch (error) {
        return handleApiError(error, 'Failed to fetch name variants');
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const personId = parseIdParam(id);
    if (personId === null) return NextResponse.json({ error: 'Invalid person ID' }, { status: 400 });

    const { searchParams } = new URL(request.url);

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    try {
        const variant = await createNameVariantService({
            personId,
            body,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json({ variant }, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to create name variant');
    }
}
