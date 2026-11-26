import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { getMyMembershipService } from '@/lib/services/members';
import { handleApiError } from '@/lib/api/handle-error';

/** GET /api/members/me — `{ isAdmin }`, so the menus know whether to offer Members. */
export async function GET() {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        return NextResponse.json(await getMyMembershipService(user));
    } catch (error) {
        return handleApiError(error, 'Failed to load membership');
    }
}
