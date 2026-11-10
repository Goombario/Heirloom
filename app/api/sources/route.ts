import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { listSourcesService, searchSourcesService, createSourceService, listRecentlyCitedSourcesService } from '@/lib/services/sources';

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
  const q = searchParams.get('q');

  try {
    if (q) {
      const sources = await searchSourcesService({ q, requestedTreeId, requestedOwnerId, currentUserId: user.id });
      return NextResponse.json({ sources });
    }
    if (searchParams.get('recent') === 'true') {
      const sources = await listRecentlyCitedSourcesService({ requestedTreeId, requestedOwnerId, currentUserId: user.id });
      return NextResponse.json({ sources });
    }
    const withCounts = searchParams.get('withCounts') === 'true';
    const { sources, count } = await listSourcesService({ requestedTreeId, requestedOwnerId, currentUserId: user.id, withCounts });
    return NextResponse.json({ sources, count });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch sources');
  }
}

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

  try {
    const source = await createSourceService({ input: body, requestedTreeId, requestedOwnerId, currentUserId: user.id });
    return NextResponse.json({ source }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to create source');
  }
}
