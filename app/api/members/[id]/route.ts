import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, isDesktopMode } from '@/lib/auth/get-user-from-request';
import {
    cancelInviteService, changeMemberRoleService, restoreMemberService, revokeMemberService,
} from '@/lib/services/members';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

const DESKTOP_DISABLED = () => NextResponse.json({ error: 'Members are not available in desktop mode' }, { status: 404 });

/**
 * PATCH /api/members/[id] — one change per request: `{ role }` (Make admin / Make
 * member) or `{ status: 'revoked' | 'active' }` (Revoke / Restore access).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    if (isDesktopMode()) return DESKTOP_DISABLED();
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const memberId = parseIdParam((await params).id);
        if (memberId === null) return NextResponse.json({ error: 'Invalid member ID' }, { status: 400 });

        const body = await request.json().catch(() => ({})) as { role?: unknown; status?: unknown };
        const hasRole = body.role !== undefined;
        const hasStatus = body.status !== undefined;
        if (hasRole === hasStatus) {
            return NextResponse.json({ error: 'Send either role or status' }, { status: 400 });
        }

        let member;
        if (hasRole) {
            member = await changeMemberRoleService({ caller: user, memberId, role: body.role });
        } else if (body.status === 'revoked') {
            member = await revokeMemberService({ caller: user, memberId });
        } else if (body.status === 'active') {
            member = await restoreMemberService({ caller: user, memberId });
        } else {
            return NextResponse.json({ error: 'Status must be "revoked" or "active"' }, { status: 400 });
        }
        return NextResponse.json({ member });
    } catch (error) {
        return handleApiError(error, 'Failed to update member');
    }
}

/** DELETE /api/members/[id] — cancel an invitation that was never used. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    if (isDesktopMode()) return DESKTOP_DISABLED();
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const memberId = parseIdParam((await params).id);
        if (memberId === null) return NextResponse.json({ error: 'Invalid member ID' }, { status: 400 });

        await cancelInviteService({ caller: user, memberId });
        return NextResponse.json({ success: true });
    } catch (error) {
        return handleApiError(error, 'Failed to cancel invitation');
    }
}
