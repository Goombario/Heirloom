import { NextResponse } from 'next/server';
import { getUserFromRequest, isDesktopMode } from '@/lib/auth/get-user-from-request';
import { getSharedWithMe } from '@/lib/db/queries/sharing';

export async function GET() {
    if (isDesktopMode()) {
        return NextResponse.json(
            { error: 'Sharing is not available in desktop mode' },
            { status: 404 }
        );
    }
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // One row per shared TREE, already joined with the tree name and the
        // owning user's identity (TreeName + owner {Id, Email, Name}).
        const shares = await getSharedWithMe(user.id);

        return NextResponse.json({ shares, count: shares.length });
    } catch (error) {
        console.error('Get shared with me error:', error);
        return NextResponse.json({ error: 'Failed to fetch shared trees' }, { status: 500 });
    }
}
