import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { createCitationsService } from '@/lib/services/citations';

/** Cite one source on many facts in one transaction (#799). */
export async function POST(request: NextRequest) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  try {
    const citations = await createCitationsService({ input: body, requestedTreeId, requestedOwnerId, currentUserId: user.id });
    return NextResponse.json({ citations }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to create citations');
  }
}
