import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { getPersonService, updatePersonService, deletePersonService } from '@/lib/services/people';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const personId = parseIdParam(id);
    if (personId === null) return NextResponse.json({ error: 'Invalid person ID' }, { status: 400 });

    const { searchParams } = new URL(request.url);
    const person = await getPersonService({
      id: personId,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });
    return NextResponse.json({ person });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch person');
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const personId = parseIdParam(id);
    if (personId === null) return NextResponse.json({ error: 'Invalid person ID' }, { status: 400 });

    const { searchParams } = new URL(request.url);
    const body = await readJsonObject(request);

    const person = await updatePersonService({
      id: personId,
      body,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });
    return NextResponse.json({ person });
  } catch (error) {
    return handleApiError(error, 'Failed to update person');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const personId = parseIdParam(id);
    if (personId === null) return NextResponse.json({ error: 'Invalid person ID' }, { status: 400 });

    const { searchParams } = new URL(request.url);
    await deletePersonService({
      id: personId,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error, 'Failed to delete person');
  }
}
