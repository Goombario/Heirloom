import { NextResponse } from 'next/server';
import { getUserFromRequest, isDesktopMode } from '@/lib/auth/get-user-from-request';
import { getOrphanMediaCheckService } from '@/lib/services/orphan-media-check';
import { handleApiError } from '@/lib/api/handle-error';

/** GET /api/members/orphan-media — the latest scheduled orphan media dry run (#946). Admin only. */
export async function GET() {
    if (isDesktopMode()) return NextResponse.json({ error: 'Members are not available in desktop mode' }, { status: 404 });
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        return NextResponse.json(await getOrphanMediaCheckService(user));
    } catch (error) {
        return handleApiError(error, 'Failed to load the orphan media check');
    }
}
