import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { renamePlaceService } from '@/lib/services/places';
import { handleApiError } from '@/lib/api/handle-error';

/** POST /api/places/rename — rename a place, or merge it into an existing one. */
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const body = await readJsonObject(request);

    const result = await renamePlaceService({
      from: body.from,
      fromId: parseOptionalIdParam(body?.fromId == null ? null : String(body.fromId), 'fromId'),
      to: body.to,
      keepOldName: body?.keepOldName === true,
      separate: body?.separate === true,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to rename place');
  }
}
