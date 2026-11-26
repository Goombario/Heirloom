import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { rateLimit } from '@/lib/rate-limit';
import { handleApiError } from '@/lib/api/handle-error';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { ValidationError } from '@/lib/validation';
import { materializeImportMediaService } from '@/lib/services/media-upload';
import { removeUnresolvedImportMediaService } from '@/lib/services/media-import-items';

type RouteParams = { params: Promise<{ id: string }> };

const REMOVE_MEDIA_RATE_LIMIT = 60;
const REMOVE_MEDIA_RATE_WINDOW_MS = 15 * 60 * 1000;

function context(request: NextRequest): { treeId: number | null; ownerId: number | null } {
  const { searchParams } = new URL(request.url);
  return {
    treeId: parseOptionalIdParam(searchParams.get('treeId'), 'treeId'),
    ownerId: parseOptionalIdParam(searchParams.get('ownerId'), 'ownerId'),
  };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { success } = rateLimit(`${user.id}:import-upload`, 1000, 15 * 60 * 1000);
    if (!success) return NextResponse.json({ error: 'Too many upload requests. Please try again later.' }, { status: 429 });
    const itemId = parseIdParam((await params).id);
    if (itemId === null) throw new ValidationError('Invalid media import item ID');
    const formData = await request.formData();
    const archivePath = formData.get('archivePath');
    const file = formData.get('file');
    if (typeof archivePath !== 'string' || !archivePath.trim()) throw new ValidationError('archivePath is required');
    if (!(file instanceof File)) throw new ValidationError('No file uploaded');
    const ctx = context(request);
    const outcome = await materializeImportMediaService({
      itemId, archivePath, file,
      requestedTreeId: ctx.treeId, requestedOwnerId: ctx.ownerId, currentUserId: user.id,
    });
    return NextResponse.json(outcome);
  } catch (error) {
    return handleApiError(error, 'Failed to materialize import media');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { success } = rateLimit(`${user.id}:import-remove`, REMOVE_MEDIA_RATE_LIMIT, REMOVE_MEDIA_RATE_WINDOW_MS);
    if (!success) return NextResponse.json({ error: 'Too many recovery requests. Please try again later.' }, { status: 429 });
    const itemId = parseIdParam((await params).id);
    if (itemId === null) throw new ValidationError('Invalid media import item ID');
    const ctx = context(request);
    await removeUnresolvedImportMediaService({
      itemId, requestedTreeId: ctx.treeId, requestedOwnerId: ctx.ownerId, currentUserId: user.id,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error, 'Failed to remove unresolved import media');
  }
}
