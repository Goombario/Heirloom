import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { isTreeEmptyService } from '@/lib/services/trees';
import { handleApiError } from '@/lib/api/handle-error';

/** Whether an owned tree holds no records, history or shares (#36): `{ isEmpty }`. */
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

    return NextResponse.json({ isEmpty: await isTreeEmptyService({ id: treeId, currentUserId: user.id }) });
  } catch (error) {
    return handleApiError(error, 'Failed to check the tree');
  }
}
