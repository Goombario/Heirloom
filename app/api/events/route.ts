import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getAllEvents, getEventsByPersonId, getEventsByFamilyId } from '@/lib/db/queries/events';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { createEventService } from '@/lib/services/events';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const personId = searchParams.get('personId');
        const familyId = searchParams.get('familyId');

        const scope = await resolveTreeScope(
            { treeId: parseIdParam(searchParams.get('treeId')), ownerId: parseIdParam(searchParams.get('ownerId')) },
            user.id
        );

        const pid = parseOptionalIdParam(personId, 'personId');
        const fid = parseOptionalIdParam(familyId, 'familyId');

        let events;
        if (pid !== null) {
            events = await getEventsByPersonId(pid, scope.treeId);
        } else if (fid !== null) {
            events = await getEventsByFamilyId(fid, scope.treeId);
        } else {
            events = await getAllEvents(scope.treeId);
        }

        const count = events.length;

        return NextResponse.json({ events, count });
    } catch (error) {
        return handleApiError(error, 'Failed to fetch events');
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await readJsonObject(request);
        const { searchParams } = new URL(request.url);

        const event = await createEventService({
            body,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        return NextResponse.json({ event }, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to create event');
    }
}
