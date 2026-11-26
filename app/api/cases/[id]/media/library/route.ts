import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { listMediaLibraryService } from '@/lib/services/cases';

export async function GET(
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

        const media = await listMediaLibraryService({ id: caseId, requestedTreeId, requestedOwnerId, currentUserId: user.id });
        return NextResponse.json({ media, count: media.length });
    } catch (error) {
        return handleApiError(error, 'Failed to fetch media library');
    }
}
