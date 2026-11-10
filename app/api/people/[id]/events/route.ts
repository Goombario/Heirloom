import { NextRequest, NextResponse } from 'next/server';
import { getEventsByPersonId, createEvent, getEventById, deleteEvent } from '@/lib/db/queries/events';
import { validateDateField, validateNameField, validateStringField } from '@/lib/validation';
import type { NewGedcomEvent } from '@/lib/db/schema';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { assertOwnerInTree } from '@/lib/services/owner-links';
import { assertNotPersonVital } from '@/lib/services/events';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const personId = parseIdParam(id);

        if (personId === null) {
            return NextResponse.json({ error: 'Invalid person ID' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        let scope;
        try {
            scope = await resolveTreeScope(
                { treeId: parseIdParam(searchParams.get('treeId')), ownerId: requestedOwnerId },
                user.id
            );
        } catch (error) {
            // AccessError → 403; anything else (e.g. a DB outage) must stay a 500.
            return handleApiError(error, 'Failed to resolve tree scope');
        }

        const events = await getEventsByPersonId(personId, scope.treeId);
        return NextResponse.json({ events, count: events.length });
    } catch (error) {
        return handleApiError(error, 'Failed to fetch events');
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const personId = parseIdParam(id);

        if (personId === null) {
            return NextResponse.json({ error: 'Invalid person ID' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        let scope;
        try {
            scope = await resolveTreeScope(
                { treeId: parseIdParam(searchParams.get('treeId')), ownerId: requestedOwnerId },
                user.id
            );
        } catch (error) {
            // AccessError → 403; anything else (e.g. a DB outage) must stay a 500.
            return handleApiError(error, 'Failed to resolve tree scope');
        }
        if (scope.permission === 'view') {
            return NextResponse.json({ error: 'View-only permission' }, { status: 403 });
        }

        // IDOR guard: the URL's person must live in the resolved tree — this
        // route inserts directly (no service layer), so check here.
        await assertOwnerInTree('People', personId, scope.treeId);

        const body = await request.json();

        const eventData: NewGedcomEvent = {
            UserId: scope.ownerId, // legacy owner column: the TREE's owner (unchanged semantics for shared contributors)
            TreeId: scope.treeId,
            Type: validateStringField(body.Type, 'Type', 100) || 'EVEN',
            Date: validateDateField(body.Date, 'Date', 50),
            Place: validateNameField(body.Place, 'Place', 500),
            Description: validateStringField(body.Description, 'Description', 1000),
            PersonId: personId,
            FamilyId: null,
        };
        assertNotPersonVital(eventData.Type, personId);

        const newEvent = await createEvent(eventData, user.id);
        return NextResponse.json({ event: newEvent }, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to create event');
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const personId = parseIdParam(id);

        if (personId === null) {
            return NextResponse.json({ error: 'Invalid person ID' }, { status: 400 });
        }

        const url = new URL(request.url);
        const requestedOwnerId = parseIdParam(url.searchParams.get('ownerId'));

        let scope;
        try {
            scope = await resolveTreeScope(
                { treeId: parseIdParam(url.searchParams.get('treeId')), ownerId: requestedOwnerId },
                user.id
            );
        } catch (error) {
            // AccessError → 403; anything else (e.g. a DB outage) must stay a 500.
            return handleApiError(error, 'Failed to resolve tree scope');
        }
        if (scope.permission === 'view' || scope.permission === 'contribute') {
            return NextResponse.json({ error: 'You do not have permission to delete records in this tree' }, { status: 403 });
        }

        const eventIdParam = url.searchParams.get('eventId');

        if (!eventIdParam) {
            return NextResponse.json({ error: 'Event ID required' }, { status: 400 });
        }

        const eventId = parseOptionalIdParam(eventIdParam, 'event ID');
        if (eventId === null) {
            return NextResponse.json({ error: 'Event ID required' }, { status: 400 });
        }
        const event = await getEventById(eventId, scope.treeId);

        if (!event || event.PersonId !== personId) {
            return NextResponse.json({ error: 'Event not found' }, { status: 404 });
        }

        await deleteEvent(eventId, scope.treeId, user.id);
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        return handleApiError(error, 'Failed to delete event');
    }
}
