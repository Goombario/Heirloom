import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { readJsonObject } from '@/lib/api/read-json';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { mergePeopleService, previewMergeService } from '@/lib/services/person-merge';

/** Two people side by side for the merge dialog (#28): `?a=&b=`. */
export async function GET(request: NextRequest) {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const aId = parseIdParam(searchParams.get('a'));
    const bId = parseIdParam(searchParams.get('b'));
    if (aId === null || bId === null) return NextResponse.json({ error: 'Two person ids are required' }, { status: 400 });
    try {
        const preview = await previewMergeService({
            aId,
            bId,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json(preview);
    } catch (error) {
        return handleApiError(error, 'Failed to compare people');
    }
}

/** Merge `otherId` into `keptId` (#28, ADR 0052): `{ keptId, otherId, take }`. */
export async function POST(request: NextRequest) {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: Record<string, unknown>;
    try {
        body = await readJsonObject(request);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const keptId = parseIdParam(body.keptId as string | number | null | undefined);
    const otherId = parseIdParam(body.otherId as string | number | null | undefined);
    if (keptId === null || otherId === null) return NextResponse.json({ error: 'keptId and otherId are required' }, { status: 400 });

    const { searchParams } = new URL(request.url);
    try {
        const result = await mergePeopleService({
            keptId,
            otherId,
            take: body.take,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to merge people');
    }
}
