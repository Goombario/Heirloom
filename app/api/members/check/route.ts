import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, isDesktopMode } from '@/lib/auth/get-user-from-request';
import { shareRecipientStatusService } from '@/lib/services/members';
import { handleApiError } from '@/lib/api/handle-error';

/**
 * GET /api/members/check?email= — `{ member, canInvite }` for the Share tree warning:
 * whether that address can use a share yet, and whether the caller may invite it.
 */
export async function GET(request: NextRequest) {
    if (isDesktopMode()) return NextResponse.json({ error: 'Members are not available in desktop mode' }, { status: 404 });
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const { searchParams } = new URL(request.url);
        return NextResponse.json(await shareRecipientStatusService({ caller: user, email: searchParams.get('email') }));
    } catch (error) {
        return handleApiError(error, 'Failed to check the address');
    }
}
