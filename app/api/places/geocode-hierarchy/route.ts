import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { upsertPlaceHierarchyService } from '@/lib/services/places';
import { handleApiError } from '@/lib/api/handle-error';

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const body = await request.json();

    const { auditIds } = await upsertPlaceHierarchyService({
      levels: body.levels,
      reparent: body.reparent,
      leafId: parseOptionalIdParam(body?.leafId == null ? null : String(body.leafId), 'leafId'),
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });

    return NextResponse.json({ ok: true, auditIds });
  } catch (error) {
    return handleApiError(error, 'Failed to save place hierarchy');
  }
}
