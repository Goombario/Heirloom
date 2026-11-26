import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { suggestFamilyService } from '@/lib/services/people';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const suggestions = await suggestFamilyService({
            lastName: searchParams.get('lastName') ?? '',
            birthDate: searchParams.get('birthDate') ?? '',
            sex: searchParams.get('sex') ?? '',
            birthPlace: searchParams.get('birthPlace') ?? '',
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        return NextResponse.json({ suggestions });
    } catch (error) {
        return handleApiError(error, 'Failed to generate suggestions');
    }
}
