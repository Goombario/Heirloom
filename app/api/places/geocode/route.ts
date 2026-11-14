import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { upsertPlaceGeocodeService } from '@/lib/services/places';
import { handleApiError } from '@/lib/api/handle-error';

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const body = await readJsonObject(request);

    await upsertPlaceGeocodeService({
      name: body.name,
      placeId: parseOptionalIdParam(body?.placeId == null ? null : String(body.placeId), 'placeId'),
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      displayName: body.displayName ?? null,
      osmType: body.osmType ?? null,
      osmId: body.osmId ?? null,
      pinSuppressed: body.pinSuppressed ?? false,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, 'Failed to save coordinates');
  }
}
