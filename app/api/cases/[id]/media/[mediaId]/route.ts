import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { unlinkMediaService } from '@/lib/services/cases';
import { getCaseById } from '@/lib/db/queries/cases';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { getDataDir } from '@/lib/data-dir';
import { unlink } from 'fs/promises';
import path from 'path';

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; mediaId: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id, mediaId: mediaIdStr } = await params;
        const caseId = parseIdParam(id);
        const mediaId = parseIdParam(mediaIdStr);
        if (caseId === null || mediaId === null) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
        // Resolved here (not just left to the service) because the file path must be
        // read BEFORE the row is deleted — mirrors app/api/media/upload/route.ts.
        const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, user.id);

        // Get file path before deletion for cleanup (server-only concern)
        const caseRecord = await getCaseById(caseId, scope.treeId);
        const mediaItem = caseRecord?.media.find(m => m.Id === mediaId);

        const result = await unlinkMediaService({ id: caseId, mediaId, requestedTreeId, requestedOwnerId, currentUserId: user.id });

        // If deleted (no person link), clean up file from disk. The upload directory is
        // keyed by the tree OWNER's user id (legacy convention, unchanged by the TreeId
        // re-anchor — see the matching directory build in app/api/media/upload/route.ts).
        if (result === 'deleted' && mediaItem?.FilePath) {
            try {
                // basename BEFORE joining — same stored-traversal guard as the
                // serving route and cleanupMediaFiles (legacy rows are untrusted).
                const filePath = path.join(getDataDir(), 'uploads', scope.ownerId.toString(), 'media', path.basename(mediaItem.FilePath));
                await unlink(filePath);
            } catch (fsErr: unknown) {
                if ((fsErr as NodeJS.ErrnoException).code !== 'ENOENT') {
                    console.error('Failed to delete media file from disk:', fsErr);
                }
            }
        }

        return new NextResponse(null, { status: 204 });
    } catch (error) {
        return handleApiError(error, 'Failed to unlink media');
    }
}
