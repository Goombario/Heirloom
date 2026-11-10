import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { searchPeopleService } from '@/lib/services/people';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  if (!q) return NextResponse.json({ error: 'Query parameter required' }, { status: 400 });

  try {
    const limitParam = searchParams.get('limit');
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : 10;
    const limit = Number.isNaN(parsedLimit) ? 10 : Math.max(1, Math.min(100, parsedLimit));

    const people = await searchPeopleService({
      q,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
      limit,
      places: searchParams.get('places') === '1',
    });
    return NextResponse.json({ people });
  } catch (error) {
    return handleApiError(error, 'Failed to search');
  }
}
