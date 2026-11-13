import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { listAuditService } from '@/lib/services/audit';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const requestedTreeId = parseIdParam(searchParams.get('treeId'));
    const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
    const page = parseOptionalIdParam(searchParams.get('page'), 'page') ?? undefined;
    const pageSize = parseOptionalIdParam(searchParams.get('pageSize'), 'pageSize') ?? undefined;
    const entityType = searchParams.get('entityType') || undefined;
    const action = searchParams.get('action') || undefined;
    const who = parseIdParam(searchParams.get('who')) ?? undefined;
    const dateFrom = searchParams.get('dateFrom') || undefined;
    const dateTo = searchParams.get('dateTo') || undefined;
    const search = searchParams.get('search') || undefined;
    const sort = searchParams.get('sort') || undefined;
    const dir = searchParams.get('dir') || undefined;

    const result = await listAuditService({
      requestedTreeId,
      requestedOwnerId,
      currentUserId: user.id,
      page,
      pageSize,
      entityType,
      action,
      who,
      dateFrom,
      dateTo,
      search,
      sort,
      dir,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to fetch audit log');
  }
}
