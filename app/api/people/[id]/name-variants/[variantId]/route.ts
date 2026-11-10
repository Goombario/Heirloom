import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { setPrimaryNameVariantService, updateNameVariantService, removeNameVariantService } from '@/lib/services/people';
import { handleApiError } from '@/lib/api/handle-error';

/**
 * PATCH — either edit this variant's text (`{ Name }`) or set/clear it as the
 * person's primary name (`{ IsPrimary }`). Setting primary clears any other
 * primary for the same person (one primary per person), in a transaction so the
 * partial unique index is never violated mid-update.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; variantId: string }> }
) {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id, variantId } = await params;
    const personId = parseIdParam(id);
    const vid = parseIdParam(variantId);
    if (personId === null || vid === null) {
        return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const requestedTreeId = parseIdParam(searchParams.get('treeId'));
    const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

    try {
        // A `Name` in the body is a text edit (with the optional "dates used"
        // range, #898); otherwise treat it as a set-primary.
        if (typeof body.Name === 'string') {
            const dates: { Type?: string; FromDate?: string | null; ToDate?: string | null } = {};
            if ('Type' in body) {
                if (typeof body.Type !== 'string') {
                    return NextResponse.json({ error: 'Invalid Type' }, { status: 400 });
                }
                dates.Type = body.Type;
            }
            for (const key of ['FromDate', 'ToDate'] as const) {
                if (!(key in body)) continue;
                const value = body[key];
                if (value !== null && typeof value !== 'string') {
                    return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 });
                }
                dates[key] = value;
            }
            const variant = await updateNameVariantService({
                personId,
                variantId: vid,
                body: { Name: body.Name, ...dates },
                requestedTreeId,
                requestedOwnerId,
                currentUserId: user.id,
            });
            return NextResponse.json({ variant });
        }

        const makePrimary = body.IsPrimary !== false; // default true when key omitted
        const variant = await setPrimaryNameVariantService({
            personId,
            variantId: vid,
            isPrimary: makePrimary,
            requestedTreeId,
            requestedOwnerId,
            currentUserId: user.id,
        });
        // `variant` carries the audit ids for Undo (#1044).
        return NextResponse.json({ success: true, variant });
    } catch (error) {
        return handleApiError(error, 'Failed to update name variant');
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; variantId: string }> }
) {
    const user = await getUserFromRequest();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id, variantId } = await params;
    const personId = parseIdParam(id);
    const vid = parseIdParam(variantId);
    if (personId === null || vid === null) {
        return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    try {
        const { auditIds } = await removeNameVariantService({
            personId,
            variantId: vid,
            requestedTreeId: parseIdParam(searchParams.get('treeId')),
            requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
            currentUserId: user.id,
        });
        return NextResponse.json({ auditIds });
    } catch (error) {
        return handleApiError(error, 'Failed to delete name variant');
    }
}
