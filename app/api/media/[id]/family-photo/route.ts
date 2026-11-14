import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { handleApiError } from '@/lib/api/handle-error';
import { clearFamilyPhotoService, setFamilyPhotoService } from '@/lib/services/media';
import { parseIdParam } from '@/lib/utils/parse-id';

/** POST { familyId } — use this photo as the family's photo (#119, ADR 0047). */
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

    const body = await readJsonObject(request).catch(() => null) as { familyId?: unknown } | null;
    const familyId = parseIdParam(body?.familyId == null ? null : String(body.familyId));
    if (familyId === null) {
      return NextResponse.json({ error: 'A valid familyId is required' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const { auditIds } = await setFamilyPhotoService({
      mediaId,
      familyId,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });
    // The audit id lets the client offer Undo.
    return NextResponse.json({ auditIds });
  } catch (error) {
    return handleApiError(error, 'Failed to set the family photo');
  }
}

/** DELETE ?familyId= — stop using this photo as that family's photo. */
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
    const familyId = parseIdParam(searchParams.get('familyId'));
    if (familyId === null) {
      return NextResponse.json({ error: 'A valid familyId is required' }, { status: 400 });
    }

    const { auditIds } = await clearFamilyPhotoService({
      mediaId,
      familyId,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });
    return NextResponse.json({ auditIds });
  } catch (error) {
    return handleApiError(error, 'Failed to clear the family photo');
  }
}
