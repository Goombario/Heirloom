import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { getTreeInfoService, renameTreeService, deleteTreeService } from '@/lib/services/trees';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const treeId = parseIdParam(id);
    if (treeId === null) {
      return NextResponse.json({ error: 'Invalid tree id' }, { status: 400 });
    }

    const result = await getTreeInfoService({ id: treeId, currentUserId: user.id });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to fetch tree');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const treeId = parseIdParam(id);
    if (treeId === null) {
      return NextResponse.json({ error: 'Invalid tree id' }, { status: 400 });
    }

    const body = await readJsonObject(request);
    const tree = await renameTreeService({ id: treeId, name: body.name, currentUserId: user.id });
    return NextResponse.json({ tree });
  } catch (error) {
    return handleApiError(error, 'Failed to rename tree');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const treeId = parseIdParam(id);
    if (treeId === null) {
      return NextResponse.json({ error: 'Invalid tree id' }, { status: 400 });
    }

    // Guarded like /api/reset: a deleted tree is NOT restorable from the audit
    // log, so deletion demands an explicit confirmation header.
    const confirmHeader = request.headers.get('X-Confirm-Delete-Tree');
    if (confirmHeader !== 'CONFIRM_DELETE_TREE') {
      return NextResponse.json(
        { error: 'Missing or invalid X-Confirm-Delete-Tree header. Send X-Confirm-Delete-Tree: CONFIRM_DELETE_TREE to confirm.' },
        { status: 400 }
      );
    }

    // 200 with the cleanup count (#945): the tree is gone either way.
    return NextResponse.json(await deleteTreeService({ id: treeId, currentUserId: user.id }));
  } catch (error) {
    return handleApiError(error, 'Failed to delete tree');
  }
}
