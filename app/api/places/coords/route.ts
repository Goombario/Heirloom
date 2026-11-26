import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { getPlaceCoordsService } from '@/lib/services/places';
import { handleApiError } from '@/lib/api/handle-error';

/**
 * POST /api/places/coords — batch resolve place names to coordinates for map pins.
 * Body: { names: string[] }. POST (not GET) so a person's many place names travel
 * in the body rather than a length-limited, comma-ambiguous query string.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const body = await readJsonObject(request).catch(() => ({}));
    const names = Array.isArray(body?.names)
      ? (body.names as unknown[]).filter((n): n is string => typeof n === 'string')
      : [];
    const ids = Array.isArray(body?.ids)
      ? (body.ids as unknown[]).map((v) => parseIdParam(v as number)).filter((v): v is number => v != null)
      : [];

    const coords = await getPlaceCoordsService({
      names,
      ids,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });

    return NextResponse.json({ coords });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch place coordinates');
  }
}
