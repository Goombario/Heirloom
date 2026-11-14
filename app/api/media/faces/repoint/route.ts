import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { rateLimit } from '@/lib/rate-limit';
import { repointFacesService } from '@/lib/services/media-faces';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        // Shared key across the four face mutations: each one loops per candidate
        // doing up to two writes, so the burst they can produce together is what
        // matters, not any single route. Generous enough for "Confirm all" over a
        // large import, which sends one request per group (#487 review).
        const { success } = rateLimit(`${user.id}:faces-mutate`, 600, 15 * 60 * 1000);
        if (!success) {
            return NextResponse.json({ error: 'Too many face review requests. Please try again later.' }, { status: 429 });
        }

        const { searchParams } = new URL(request.url);
        const body = await readJsonObject(request);
        const candidateIds = Array.isArray(body.candidateIds) ? body.candidateIds as number[] : [];
        if (candidateIds.length === 0) {
            return NextResponse.json({ error: 'candidateIds must be a non-empty array of ids' }, { status: 400 });
        }

        const result = await repointFacesService({
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
            candidateIds,
            personId: Number(body.personId),
        });
        return NextResponse.json(result);
    } catch (error) {
        return handleApiError(error, 'Failed to reassign faces');
    }
}
