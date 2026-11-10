import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, isDesktopMode } from '@/lib/auth/get-user-from-request';
import { updateSharePermissionService, deleteShareService } from '@/lib/services/sharing';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

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

        const resolvedParams = await params;
        const shareId = parseIdParam(resolvedParams.id);
        if (shareId === null) {
            return NextResponse.json({ error: 'Invalid share ID' }, { status: 400 });
        }

        const body = await request.json() as { permission?: unknown };
        const share = await updateSharePermissionService({
            shareId,
            permission: body.permission,
            currentUserId: user.id,
        });

        return NextResponse.json({ share });
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

        const resolvedParams = await params;
        const shareId = parseIdParam(resolvedParams.id);
        if (shareId === null) {
            return NextResponse.json({ error: 'Invalid share ID' }, { status: 400 });
        }

        await deleteShareService({ shareId, currentUserId: user.id });
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        return handleApiError(error, 'Failed to delete share');
    }
}
