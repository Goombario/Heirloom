import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { listFlaggedPeopleService } from '@/lib/services/people';
import { handleApiError } from '@/lib/api/handle-error';

/** GET /api/people/flagged?filter=duplicates — the groups of people behind the likely-duplicates suggestion (#794, #822). */
export async function GET(request: NextRequest) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const flag = searchParams.get('filter');
  if (flag !== 'duplicates') {
    return NextResponse.json({ error: 'filter must be duplicates' }, { status: 400 });
  }

  try {
    const groups = await listFlaggedPeopleService({
      flag,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });
    return NextResponse.json({ groups });
  } catch (error) {
    return handleApiError(error, 'Failed to list flagged people');
  }
}
