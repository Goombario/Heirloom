import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { removeCitationService, updateCitationService } from '@/lib/services/citations';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const citationId = parseIdParam(id);
  if (citationId === null) return NextResponse.json({ error: 'Invalid citation ID' }, { status: 400 });
  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

  try {
    const body = await readJsonObject(request);
    const citation = await updateCitationService({
      id: citationId,
      input: { Page: body.Page, Quay: body.Quay, DataText: body.DataText, Url: body.Url },
      requestedTreeId,
      requestedOwnerId,
      currentUserId: user.id,
    });
    return NextResponse.json({ citation });
  } catch (error) {
    return handleApiError(error, 'Failed to update citation');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const citationId = parseIdParam(id);
  if (citationId === null) return NextResponse.json({ error: 'Invalid citation ID' }, { status: 400 });
  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

  try {
    const { auditIds } = await removeCitationService({ id: citationId, requestedTreeId, requestedOwnerId, currentUserId: user.id });
    return NextResponse.json({ auditIds });
  } catch (error) {
    return handleApiError(error, 'Failed to delete citation');
  }
}
