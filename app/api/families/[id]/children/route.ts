import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseBodyId, parseIdParam } from '@/lib/utils/parse-id';
import { addChildToFamilyService, updateChildTypeService, removeChildService } from '@/lib/services/families';
import { parseChildRelationships } from '@/lib/child-relationship';
import { handleApiError } from '@/lib/api/handle-error';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const resolvedParams = await params;
        const familyId = parseIdParam(resolvedParams.id);
        const body = await readJsonObject(request);
        const { relationshipType } = body;
        const childId = parseBodyId(body.childId, 'childId');

        if (!familyId || !childId) {
            return NextResponse.json({ error: 'Family ID and child ID are required' }, { status: 400 });
        }

        // Optional on add-child (omitted means Birth for both partners). Either one
        // type for both partners or `{ partner1, partner2 }` (#982).
        const relationship = parseChildRelationships(relationshipType ?? 'Birth');
        if (!relationship) {
            return NextResponse.json({ error: 'Invalid relationshipType' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const { auditIds } = await addChildToFamilyService({
            familyId,
            childId,
            relationship,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        // The audit ids let the client offer Undo (#1044).
        return NextResponse.json({ success: true, auditIds }, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to add child');
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const resolvedParams = await params;
        const familyId = parseIdParam(resolvedParams.id);
        const body = await readJsonObject(request);
        const { relationshipType } = body;
        const childId = parseBodyId(body.childId, 'childId');

        if (!familyId || !childId) {
            return NextResponse.json({ error: 'Family ID and child ID are required' }, { status: 400 });
        }

        // Required here (unlike POST): this endpoint exists only to set the value.
        const relationship = parseChildRelationships(relationshipType);
        if (!relationship) {
            return NextResponse.json({ error: 'Invalid relationshipType' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const { auditIds } = await updateChildTypeService({
            familyId,
            childId,
            relationship,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        return NextResponse.json({ success: true, auditIds });
    } catch (error) {
        return handleApiError(error, 'Failed to update child relationship type');
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const resolvedParams = await params;
        const familyId = parseIdParam(resolvedParams.id);
        const childId = parseBodyId((await readJsonObject(request)).childId, 'childId');

        if (!familyId || !childId) {
            return NextResponse.json({ error: 'Family ID and child ID are required' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const { auditId } = await removeChildService({
            familyId,
            childId,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });

        // The audit entry's Id lets the UI offer Undo through the audit revert (#788).
        return NextResponse.json({ auditId });
    } catch (error) {
        return handleApiError(error, 'Failed to remove child');
    }
}
