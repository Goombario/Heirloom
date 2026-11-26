import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { rateLimit } from '@/lib/rate-limit';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { findDuplicatesService } from '@/lib/services/media-duplicates';

/**
 * POST /api/media/duplicates — HTTP shell only. Auth, rate limiting, body
 * extraction and error→status mapping live here; validation and the tree-scoped
 * lookup are in `lib/services/media-duplicates.ts`.
 *
 * POST rather than GET despite being read-only: a 100-photo batch's hashes
 * exceed practical URL limits. Only hashes cross the wire, never image bytes.
 */
export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // One pre-flight per batch — far cheaper than the upload bucket beside
        // it, but sized so re-picking files repeatedly never hits a wall.
        const { success } = rateLimit(`${user.id}:duplicates`, 300, 15 * 60 * 1000);
        if (!success) {
            return NextResponse.json({ error: 'Too many duplicate checks. Please try again later.' }, { status: 429 });
        }

        const { searchParams } = new URL(request.url);
        // A malformed body is a client error, not a 500: fall through to the
        // service's own "hashes must be an array" ValidationError → 400.
        const body = await readJsonObject(request).catch(() => ({}));

        const matches = await findDuplicatesService({
            hashes: (body as { hashes?: unknown }).hashes,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        return NextResponse.json({ matches });
    } catch (error) {
        return handleApiError(error, 'Failed to check for duplicates');
    }
}
