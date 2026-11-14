import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { linkMediaForOwnerService, listLinkOwnersForMediaService } from '@/lib/services/media-links';
import { isMediaOwnerTable } from '@/lib/db/fact-tables';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

/**
 * GET /api/media/[id]/links — every record this media row is linked to, named
 * for the viewer's "Linked to" list (#510). Returns `{ owners: MediaLinkOwner[] }`.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await params;
        const mediaId = parseIdParam(id);
        if (mediaId === null) return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });

        const { searchParams } = new URL(request.url);
        const owners = await listLinkOwnersForMediaService({
            mediaId,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json({ owners });
    } catch (error) {
        return handleApiError(error, 'Failed to list media links');
    }
}

/**
 * POST /api/media/[id]/links — attach an EXISTING media row to an owner record
 * (family/source/event/…) via MediaLink. Body: `{ ownerTable, recordId, ownerFact? }`;
 * `ownerFact` scopes the link to the record's Birth, Death or Marriage (ADR 0030).
 * The link is the RESTful subresource of the media; the mirror of the
 * `DELETE /api/media/[id]?ownerTable=&recordId=` unlink.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await params;
        const mediaId = parseIdParam(id);
        if (mediaId === null) return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });

        const { searchParams } = new URL(request.url);
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        const body = await request.json();
        if (!isMediaOwnerTable(body.ownerTable)) {
            return NextResponse.json({ error: 'Invalid ownerTable' }, { status: 400 });
        }
        const recordId = parseIdParam(body.recordId);
        if (recordId === null) return NextResponse.json({ error: 'Invalid recordId' }, { status: 400 });

        await linkMediaForOwnerService({
            mediaId,
            ownerTable: body.ownerTable,
            ownerId: recordId,
            ownerFact: body.ownerFact == null ? null : String(body.ownerFact),
            requestedTreeId,
            requestedOwnerId,
            currentUserId: user.id,
        });
        return NextResponse.json({ success: true }, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to link media');
    }
}
