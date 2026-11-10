import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { handleApiError } from '@/lib/api/handle-error';
import { clearPrimaryMediaService, setPrimaryMediaService } from '@/lib/services/media';
import { parseIdParam } from '@/lib/utils/parse-id';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const mediaId = parseIdParam((await params).id);
    if (mediaId === null) {
      return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });
    }

    const body = await request.json() as { personId?: unknown };
    const personId = parseIdParam(body.personId == null ? null : String(body.personId));
    if (personId === null) {
      return NextResponse.json({ error: 'A valid personId is required' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const { auditIds } = await setPrimaryMediaService({
      mediaId,
      personId,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });
    // The audit id lets the client offer Undo (#1044).
    return NextResponse.json({ auditIds });
  } catch (error) {
    return handleApiError(error, 'Failed to set primary media');
  }
}

/** DELETE ?personId= — stop using this photo as that person's portrait (#1051). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const mediaId = parseIdParam((await params).id);
    if (mediaId === null) {
      return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const personId = parseIdParam(searchParams.get('personId'));
    if (personId === null) {
      return NextResponse.json({ error: 'A valid personId is required' }, { status: 400 });
    }

    const { auditIds } = await clearPrimaryMediaService({
      mediaId,
      personId,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });
    return NextResponse.json({ auditIds });
  } catch (error) {
    return handleApiError(error, 'Failed to clear primary media');
  }
}
