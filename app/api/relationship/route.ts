import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { getRelationshipService } from '@/lib/services/relationship';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const person1Id = parseIdParam(searchParams.get('person1'));
    const person2Id = parseIdParam(searchParams.get('person2'));

    if (person1Id === null || person2Id === null) {
        return NextResponse.json({ error: 'Both person1 and person2 IDs required' }, { status: 400 });
    }

    // Same-person check before auth — matches original route behaviour.
    if (person1Id === person2Id) {
        return NextResponse.json({ relationship: 'Same person', path: [], degree: 0 });
    }

    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const result = await getRelationshipService({
            person1Id,
            person2Id,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to calculate relationship');
    }
}
