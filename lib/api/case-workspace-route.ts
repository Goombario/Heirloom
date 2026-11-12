import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import type { WorkspaceScopeParams } from '@/lib/services/case-workspace';

/**
 * The research workspace's routes (#58) share one shape: sign-in, the case id and
 * any child id from the path, the tree scope from the query, and a JSON body for a
 * write. Each route passes its service; this validates the HTTP side only.
 */
export async function workspaceRoute<K extends string>(
    request: NextRequest,
    params: Promise<Record<string, string>>,
    childKey: K | null,
    run: (scope: WorkspaceScopeParams & { childId: number; body: unknown }) => Promise<unknown>,
    options: { read?: boolean; status?: number; failure: string },
) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const path = await params;
        const caseId = parseIdParam(path.id);
        const childId = childKey ? parseIdParam(path[childKey]) : 0;
        if (caseId === null || childId === null) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
        let body: unknown = null;
        if (!options.read) {
            body = await request.json().catch(() => undefined);
            if (body === undefined) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        const { searchParams } = new URL(request.url);
        const result = await run({
            caseId,
            childId,
            body,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json(result, { status: options.status ?? 200 });
    } catch (error) {
        return handleApiError(error, options.failure);
    }
}
