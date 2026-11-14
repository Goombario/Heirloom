import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import { revertAuditService } from '@/lib/services/audit';

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const requestedTreeId = parseIdParam(searchParams.get('treeId'));
    const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

    let body: { ids?: unknown };
    try {
      body = await readJsonObject(request);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const ids: number[] = body.ids as number[];

    const result = await revertAuditService({ ids, requestedTreeId, requestedOwnerId, currentUserId: user.id });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    // Same JSON error shape as every other route (a re-throw surfaced Next's
    // opaque 500 instead of { error }).
    console.error('Audit revert error:', error);
    return NextResponse.json({ error: 'Failed to revert audit entries' }, { status: 500 });
  }
}
