import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { updatePlaceCoordinatesService } from '@/lib/services/places';
import { handleApiError } from '@/lib/api/handle-error';

/** POST /api/places/coordinates — adjust coordinates without changing provenance. */
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    await updatePlaceCoordinatesService({
      name: body?.name,
      placeId: parseOptionalIdParam(body?.placeId == null ? null : String(body.placeId), 'placeId'),
      latitude: body?.latitude,
      longitude: body?.longitude,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, 'Failed to update place coordinates');
  }
}
