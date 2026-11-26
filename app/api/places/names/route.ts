import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { savePlaceNamesService } from '@/lib/services/places';
import { handleApiError } from '@/lib/api/handle-error';

/** POST /api/places/names — replace a place's other names (#1185). */
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const body = await readJsonObject(request);

    const result = await savePlaceNamesService({
      placeId: Number(body?.placeId),
      names: body?.names,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to save the place’s other names');
  }
}
