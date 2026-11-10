import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, isDesktopMode } from '@/lib/auth/get-user-from-request';
import { listSharesService, listPendingSharesService, createShareService } from '@/lib/services/sharing';
import { handleApiError } from '@/lib/api/handle-error';

const DESKTOP_DISABLED = NextResponse.json(
    { error: 'Sharing is not available in desktop mode' },
    { status: 404 }
);

export async function GET() {
    if (isDesktopMode()) return DESKTOP_DISABLED;
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const [shares, pending] = await Promise.all([
            listSharesService({ currentUserId: user.id }),
            listPendingSharesService({ currentUserId: user.id }),
        ]);
        return NextResponse.json({ shares, pending, count: shares.length });
    } catch (error) {
        return handleApiError(error, 'Failed to fetch shares');
    }
}

export async function POST(request: NextRequest) {
    if (isDesktopMode()) return DESKTOP_DISABLED;
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const result = await createShareService({
            email: body.email,
            permission: body.permission,
            treeId: body.treeId,
            currentUserId: user.id,
        });

        // { share } for an existing user; { pending } for an address with no
        // account yet, applied at that person's first sign-in (#1228).
        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        if (error instanceof Error && error.message.includes('already shared')) {
            return NextResponse.json({ error: error.message }, { status: 409 });
        }
        return handleApiError(error, 'Failed to create share');
    }
}
