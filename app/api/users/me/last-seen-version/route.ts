import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { handleApiError } from '@/lib/api/handle-error';
import { getLastSeenVersionService, setLastSeenVersionService } from '@/lib/services/account';

/**
 * GET /api/users/me/last-seen-version - the last version whose What's new the
 * signed-in user has seen (#35), or null before the first.
 */
export async function GET() {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const version = await getLastSeenVersionService(user.id);
    return NextResponse.json({ version });
  } catch (error) {
    return handleApiError(error, 'Failed to read the last seen version');
  }
}

/** PUT /api/users/me/last-seen-version - body `{ version }`; records it for the signed-in user. */
export async function PUT(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    let body: { version?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    await setLastSeenVersionService(user.id, body?.version);
    return NextResponse.json({ version: body.version });
  } catch (error) {
    return handleApiError(error, 'Failed to record the last seen version');
  }
}
