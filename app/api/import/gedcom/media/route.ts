import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { rateLimit } from '@/lib/rate-limit';
import { handleApiError } from '@/lib/api/handle-error';
import { parseOptionalIdParam } from '@/lib/utils/parse-id';
import { ValidationError } from '@/lib/validation';
import {
  listUnresolvedImportMediaService,
  MAX_MISSING_MEDIA_BATCH,
  markImportMediaMissingService,
  removeUnresolvedImportMediaBatchService,
} from '@/lib/services/media-import-items';

// A deliberately conservative cap keeps one authenticated request from
// holding locks and issuing hundreds of state transitions at once.
const MISSING_MEDIA_RATE_LIMIT = 30;
const MISSING_MEDIA_RATE_WINDOW_MS = 15 * 60 * 1000;
// Bulk remove has its own budget, counted per request rather than per item, so
// clearing a 250-photo import takes three requests, not 250 (#859).
const REMOVE_BATCH_RATE_LIMIT = 30;
const REMOVE_BATCH_RATE_WINDOW_MS = 15 * 60 * 1000;

async function readItemIds(request: NextRequest): Promise<number[]> {
  let body: unknown;
  try { body = await request.json(); } catch { throw new ValidationError('Request body must be valid JSON'); }
  const itemIds = body && typeof body === 'object' ? (body as { itemIds?: unknown }).itemIds : undefined;
  if (!Array.isArray(itemIds)) throw new ValidationError('itemIds must be a non-empty array');
  if (itemIds.length > MAX_MISSING_MEDIA_BATCH) {
    throw new ValidationError(`itemIds must contain at most ${MAX_MISSING_MEDIA_BATCH} items`);
  }
  return itemIds as number[];
}

function treeContext(request: NextRequest): { treeId: number | null; ownerId: number | null } {
  const { searchParams } = new URL(request.url);
  return {
    treeId: parseOptionalIdParam(searchParams.get('treeId'), 'treeId'),
    ownerId: parseOptionalIdParam(searchParams.get('ownerId'), 'ownerId'),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const ctx = treeContext(request);
    const items = await listUnresolvedImportMediaService({ requestedTreeId: ctx.treeId, requestedOwnerId: ctx.ownerId, currentUserId: user.id });
    return NextResponse.json({ items, count: items.length });
  } catch (error) {
    return handleApiError(error, 'Failed to list unresolved import media');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { success } = rateLimit(`${user.id}:import-missing`, MISSING_MEDIA_RATE_LIMIT, MISSING_MEDIA_RATE_WINDOW_MS);
    if (!success) return NextResponse.json({ error: 'Too many recovery requests. Please try again later.' }, { status: 429 });
    const ctx = treeContext(request);
    const itemIds = await readItemIds(request);
    const items = await markImportMediaMissingService({ requestedTreeId: ctx.treeId, requestedOwnerId: ctx.ownerId, currentUserId: user.id, itemIds });
    return NextResponse.json({ items, count: items.length });
  } catch (error) {
    return handleApiError(error, 'Failed to mark import media missing');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { success } = rateLimit(`${user.id}:import-remove-batch`, REMOVE_BATCH_RATE_LIMIT, REMOVE_BATCH_RATE_WINDOW_MS);
    if (!success) return NextResponse.json({ error: 'Too many recovery requests. Please try again later.' }, { status: 429 });
    const ctx = treeContext(request);
    const itemIds = await readItemIds(request);
    const removedIds = await removeUnresolvedImportMediaBatchService({ requestedTreeId: ctx.treeId, requestedOwnerId: ctx.ownerId, currentUserId: user.id, itemIds });
    return NextResponse.json({ removedIds, count: removedIds.length });
  } catch (error) {
    return handleApiError(error, 'Failed to remove unresolved import media');
  }
}
