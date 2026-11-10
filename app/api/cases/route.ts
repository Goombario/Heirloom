import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { listCasesService, createCaseService } from '@/lib/services/cases';

export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
        const status = searchParams.get('status') ?? undefined;
        const tag = searchParams.get('tag') ?? undefined;
        const search = searchParams.get('search') ?? undefined;
        const personId = parseOptionalIdParam(searchParams.get('personId'), 'personId') ?? undefined;

        const result = await listCasesService({
            requestedTreeId,
            requestedOwnerId,
            currentUserId: user.id,
            status,
            tag,
            search,
            personId,
        });
        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to fetch cases');
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        const createdCase = await createCaseService({
            body,
            requestedTreeId,
            requestedOwnerId,
            currentUserId: user.id,
        });
        return NextResponse.json({ case: createdCase }, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to create case');
    }
}
