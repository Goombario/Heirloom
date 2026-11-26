import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { citedBySourceService } from '@/lib/services/sources';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const sourceId = parseIdParam(id);
  if (sourceId === null) return NextResponse.json({ error: 'Invalid source ID' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

  try {
    const citations = await citedBySourceService({ id: sourceId, requestedTreeId, requestedOwnerId, currentUserId: user.id });
    return NextResponse.json({ citations, count: citations.length });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch citations for source');
  }
}
