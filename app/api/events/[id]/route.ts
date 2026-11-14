import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getEventById } from '@/lib/db/queries/events';
import { updateEventService, deleteEventService } from '@/lib/services/events';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { parseIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';

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
        const eventId = parseIdParam(id);

        if (eventId === null) {
            return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const scope = await resolveTreeScope(
            { treeId: parseIdParam(searchParams.get('treeId')), ownerId: parseIdParam(searchParams.get('ownerId')) },
            user.id
        );

        const event = await getEventById(eventId, scope.treeId);

        if (!event) {
            return NextResponse.json({ error: 'Event not found' }, { status: 404 });
        }

        return NextResponse.json({ event });
    } catch (error) {
        return handleApiError(error, 'Failed to fetch event');
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const eventId = parseIdParam(id);

        if (eventId === null) {
            return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const body = await readJsonObject(request);
        // The service checks the tree scope, that a re-pointed PersonId/FamilyId
        // is in the same tree, and that a person gets no BIRT/DEAT row (#756).
        const event = await updateEventService({
            eventId,
            body,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json({ event });
    } catch (error) {
        return handleApiError(error, 'Failed to update event');
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
        const eventId = parseIdParam(id);

        if (eventId === null) {
            return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const { deleted, auditIds } = await deleteEventService({
            eventId,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        if (!deleted) {
            return NextResponse.json({ error: 'Event not found' }, { status: 404 });
        }

        // The audit ids let the client offer Undo (#1044).
        return NextResponse.json({ auditIds });
    } catch (error) {
        return handleApiError(error, 'Failed to delete event');
    }
}
