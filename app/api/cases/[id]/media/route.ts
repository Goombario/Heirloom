import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { linkMediaService } from '@/lib/services/cases';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await params;
        const caseId = parseIdParam(id);
        if (caseId === null) return NextResponse.json({ error: 'Invalid case ID' }, { status: 400 });

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        const body = await readJsonObject(request);
        const mediaIds: number[] = Array.isArray(body.mediaIds)
            ? body.mediaIds.map((mid: unknown) => Number(mid)).filter((n: number) => !isNaN(n))
            : [];

        const result = await linkMediaService({ id: caseId, mediaIds, requestedTreeId, requestedOwnerId, currentUserId: user.id });
        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to link media');
    }
}
