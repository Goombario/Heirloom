import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { listSavedSearchesService, saveSearchService } from '@/lib/services/advanced-search';
import { rateLimit } from '@/lib/rate-limit';

/** The member's own saved People searches for a tree, with live counts (#247). */
export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        // Listing re-runs every saved search against the tree.
        if (!rateLimit(`${user.id}:saved-searches`, 60, 60 * 1000).success) {
            return NextResponse.json({ error: 'Too many requests. Please try again in a minute.' }, { status: 429 });
        }
        const { searchParams } = new URL(request.url);
        const searches = await listSavedSearchesService({
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json({ searches });
    } catch (error) {
        return handleApiError(error, 'Failed to load saved searches');
    }
}

/** POST { name, query }: save a search under a name. */
export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const { searchParams } = new URL(request.url);
        const body = await request.json().catch(() => null) as { name?: unknown; query?: unknown } | null;
        if (!body || typeof body !== 'object') return NextResponse.json({ error: 'A JSON body is required' }, { status: 400 });
        const saved = await saveSearchService({
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
            name: body.name,
            query: body.query,
        });
        return NextResponse.json({ search: saved }, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to save the search');
    }
}
