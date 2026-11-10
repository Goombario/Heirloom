import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { moveChildService } from '@/lib/services/families';
import { handleApiError } from '@/lib/api/handle-error';

/** Move a child from this family to another in one audited step (#796). */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const resolvedParams = await params;
        const familyId = parseIdParam(resolvedParams.id);
        const { childId, toFamilyId } = await request.json();

        if (!familyId || !Number.isInteger(childId) || !Number.isInteger(toFamilyId)) {
            return NextResponse.json({ error: 'Family ID, child ID and target family ID are required' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const { auditId } = await moveChildService({
            familyId,
            toFamilyId,
            childId,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        // The audit entry's Id lets the UI offer Undo through the audit revert.
        return NextResponse.json({ auditId });
    } catch (error) {
        return handleApiError(error, 'Failed to move child');
    }
}
