import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, isDesktopMode } from '@/lib/auth/get-user-from-request';
import { listMemberLogService } from '@/lib/services/members';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

/** GET /api/members/log?page=&pageSize= — the admin log, newest first. Admin only. */
export async function GET(request: NextRequest) {
    if (isDesktopMode()) return NextResponse.json({ error: 'Members are not available in desktop mode' }, { status: 404 });
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const { searchParams } = new URL(request.url);
        const result = await listMemberLogService({
            caller: user,
            page: parseIdParam(searchParams.get('page')),
            pageSize: parseIdParam(searchParams.get('pageSize')),
        });
        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to load the admin log');
    }
}
