import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { getPlaceDependentCountService } from '@/lib/services/places';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    const placeId = parseOptionalIdParam(searchParams.get('id'), 'id');
    if (!name && placeId == null) return NextResponse.json({ error: 'name or id is required' }, { status: 400 });

    const count = await getPlaceDependentCountService({
      name: name ?? undefined,
      placeId,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });

    return NextResponse.json({ count });
  } catch (error) {
    return handleApiError(error, 'Failed to check place dependents');
  }
}
