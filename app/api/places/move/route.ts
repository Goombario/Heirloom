import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { movePlaceRecordsService } from '@/lib/services/places';
import { handleApiError } from '@/lib/api/handle-error';

/** POST /api/places/move — point records of one place at another (#1186). */
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const body = await readJsonObject(request);
    const fromId = parseIdParam(body?.fromId);
    const toId = parseIdParam(body?.toId);
    if (fromId === null || toId === null) {
      return NextResponse.json({ error: 'fromId and toId must be place ids' }, { status: 400 });
    }

    const result = await movePlaceRecordsService({
      fromId,
      toId,
      records: body?.records,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to move records');
  }
}
