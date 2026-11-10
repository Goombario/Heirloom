import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { rateLimit } from '@/lib/rate-limit';
import { restoreFaceSuggestionsService } from '@/lib/services/media-faces';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

/**
 * Undo for a re-point.
 *
 * Re-pointing overwrites `SuggestedPersonId`/`MatchKind` on a row that stays
 * pending, so unlike confirm and dismiss there is no status transition for
 * /undo to walk back — the prior values come back from /repoint and return here.
 *
 * The body is client-supplied and entirely untrusted; the service re-scopes
 * every candidate id to the tree, checks each person id exists in that tree, and
 * validates each match kind. This route only shapes the payload.
 */
export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        // Same shared key as the other face mutations — see repoint/route.ts.
        const { success } = rateLimit(`${user.id}:faces-mutate`, 600, 15 * 60 * 1000);
        if (!success) {
            return NextResponse.json({ error: 'Too many face review requests. Please try again later.' }, { status: 429 });
        }

        const { searchParams } = new URL(request.url);
        const body = await request.json();
        const previous = Array.isArray(body.previous)
            ? body.previous
                .filter((s: unknown): s is Record<string, unknown> => typeof s === 'object' && s !== null)
                .map((s: Record<string, unknown>) => ({
                    id: Number(s.id),
                    personId: s.personId == null ? null : Number(s.personId),
                    kind: String(s.kind),
                }))
            : [];
        if (previous.length === 0) {
            return NextResponse.json({ error: 'previous must be a non-empty array of suggestions' }, { status: 400 });
        }

        const result = await restoreFaceSuggestionsService({
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
            previous,
        });
        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to undo the face reassignment');
    }
}
