import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, isDesktopMode } from '@/lib/auth/get-user-from-request';
import { inviteMemberService, listMembersService } from '@/lib/services/members';
import { handleApiError } from '@/lib/api/handle-error';

/** Hosted membership (ADR 0029): admin only. The service re-checks the caller. */
const DESKTOP_DISABLED = () => NextResponse.json({ error: 'Members are not available in desktop mode' }, { status: 404 });

/** GET /api/members — every member and invitation, for the Members page. */
export async function GET() {
    if (isDesktopMode()) return DESKTOP_DISABLED();
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        return NextResponse.json(await listMembersService(user));
    } catch (error) {
        return handleApiError(error, 'Failed to load members');
    }
}

/** POST /api/members — invite a Google address as a member or admin. No email is sent. */
export async function POST(request: NextRequest) {
    if (isDesktopMode()) return DESKTOP_DISABLED();
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const body = await readJsonObject(request).catch(() => ({})) as { email?: unknown; role?: unknown };
        const member = await inviteMemberService({ caller: user, email: body.email, role: body.role });
        return NextResponse.json({ member }, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to invite member');
    }
}
