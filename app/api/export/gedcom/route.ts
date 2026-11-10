import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { rateLimit } from '@/lib/rate-limit';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { exportGedcomService } from '@/lib/services/gedcom-export';

/**
 * GET /api/export/gedcom — HTTP shell only. Auth, rate limiting, query parsing,
 * and error→status mapping live here; the tree-scope resolution, batched reads,
 * relation assembly, and GEDCOM/zip rendering are in
 * `lib/services/gedcom-export.ts`.
 */
export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Rate limit: 10 exports per 15 minutes
        const { success } = rateLimit(`${user.id}:export`, 10, 15 * 60 * 1000);
        if (!success) {
            return NextResponse.json({ error: 'Too many export requests. Please try again later.' }, { status: 429 });
        }

        const { searchParams } = new URL(request.url);
        const preflightOnly = searchParams.get('preflight') === 'true';
        const result = await exportGedcomService({
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
            includeMedia: preflightOnly || searchParams.get('includeMedia') === 'true',
            preflightOnly,
            mediaPolicy: searchParams.get('mediaPolicy') ?? undefined,
        });

        if (result.kind === 'preflight') {
            return NextResponse.json(result.preflight);
        }
        if (result.kind === 'blocked') {
            return NextResponse.json(
                {
                    error: 'Media export blocked because unresolved media would be omitted',
                    preflight: result.preflight,
                },
                { status: 409 },
            );
        }
        if (result.kind === 'ged') {
            return new NextResponse(result.content, {
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Content-Disposition': 'attachment; filename="family_tree.ged"',
                },
            });
        }

        return new NextResponse(new Uint8Array(result.buffer), {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': 'attachment; filename="family_tree_export.zip"',
            },
        });
    } catch (error) {
        return handleApiError(error, 'Failed to export GEDCOM file');
    }
}
