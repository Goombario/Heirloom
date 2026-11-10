import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { getSourceService, updateSourceService, removeSourceService } from '@/lib/services/sources';

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
    const source = await getSourceService({ id: sourceId, requestedTreeId, requestedOwnerId, currentUserId: user.id });
    return NextResponse.json({ source });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch source');
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const sourceId = parseIdParam(id);
  if (sourceId === null) return NextResponse.json({ error: 'Invalid source ID' }, { status: 400 });
  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const source = await updateSourceService({ id: sourceId, patch: body, requestedTreeId, requestedOwnerId, currentUserId: user.id });
    return NextResponse.json({ source });
  } catch (error) {
    return handleApiError(error, 'Failed to update source');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const sourceId = parseIdParam(id);
  if (sourceId === null) return NextResponse.json({ error: 'Invalid source ID' }, { status: 400 });
  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

  try {
    await removeSourceService({ id: sourceId, requestedTreeId, requestedOwnerId, currentUserId: user.id });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error, 'Failed to delete source');
  }
}
