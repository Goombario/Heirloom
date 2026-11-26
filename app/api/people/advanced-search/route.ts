import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { searchPeopleService } from '@/lib/services/advanced-search';
import { rateLimit } from '@/lib/rate-limit';

/** POST { query, explain? }: the people an advanced search matches (#247). */
export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        // Each search reads the whole tree's index: 120 a minute is far above typing speed.
        if (!rateLimit(`${user.id}:people-search`, 120, 60 * 1000).success) {
            return NextResponse.json({ error: 'Too many searches. Please try again in a minute.' }, { status: 429 });
        }
        const { searchParams } = new URL(request.url);
        const body = await request.json().catch(() => null) as { query?: unknown; explain?: unknown } | null;
        if (!body || typeof body !== 'object') return NextResponse.json({ error: 'A JSON body is required' }, { status: 400 });
        const result = await searchPeopleService({
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
            query: body.query,
            explain: body.explain === true,
        });
        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to search people');
    }
}
