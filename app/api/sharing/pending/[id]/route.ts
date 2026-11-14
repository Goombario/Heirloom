import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, isDesktopMode } from '@/lib/auth/get-user-from-request';
import { updatePendingShareService, deletePendingShareService } from '@/lib/services/sharing';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

/** A pending share (#1228): a tree shared with an address that has no account yet. */

const DESKTOP_DISABLED = NextResponse.json(
    { error: 'Sharing is not available in desktop mode' },
    { status: 404 }
);

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (isDesktopMode()) return DESKTOP_DISABLED;
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const pendingId = parseIdParam((await params).id);
        if (pendingId === null) {
            return NextResponse.json({ error: 'Invalid share ID' }, { status: 400 });
        }

        const body = await readJsonObject(request) as { permission?: unknown };
        const pending = await updatePendingShareService({
            pendingId,
            permission: body.permission,
            currentUserId: user.id,
        });

        return NextResponse.json({ pending });
    } catch (error) {
        return handleApiError(error, 'Failed to update share');
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (isDesktopMode()) return DESKTOP_DISABLED;
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const pendingId = parseIdParam((await params).id);
        if (pendingId === null) {
            return NextResponse.json({ error: 'Invalid share ID' }, { status: 400 });
        }

        await deletePendingShareService({ pendingId, currentUserId: user.id });
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        return handleApiError(error, 'Failed to delete share');
    }
}
