import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { handleApiError } from '@/lib/api/handle-error';
import { getMediaStorageSummaryService } from '@/lib/services/media-storage';
import { parseIdParam } from '@/lib/utils/parse-id';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const summary = await getMediaStorageSummaryService({
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });
    return NextResponse.json(summary);
  } catch (error) {
    return handleApiError(error, 'Failed to fetch media storage');
  }
}
