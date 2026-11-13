import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { deleteMediaBatchService, listMediaService } from '@/lib/services/media';
import { createMetadataMediaService } from '@/lib/services/media-upload';
import { listGalleryForOwnerService, listMediaForOwnerService } from '@/lib/services/media-links';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { ValidationError } from '@/lib/validation';
import { rateLimit } from '@/lib/rate-limit';

const BULK_DELETE_RATE_LIMIT = 100;
const BULK_DELETE_RATE_WINDOW_MS = 15 * 60 * 1000;

function parseStrictOptionalIdParam(value: string | null, name: string): number | null {
    if (value === null) return null;
    if (!/^[1-9]\d*$/.test(value)) throw new ValidationError(`Invalid ${name}`);
    const id = Number(value);
    if (!Number.isSafeInteger(id)) throw new ValidationError(`Invalid ${name}`);
    return id;
}

export async function GET(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const personId = searchParams.get('personId');
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        // Media attached to a polymorphic owner (family / source / …) via MediaLink.
        const ownerTable = searchParams.get('ownerTable');
        if (ownerTable) {
            // A present ownerTable with a malformed recordId is a client error — 400
            // rather than silently falling through to the unfiltered media list.
            const recordId = parseIdParam(searchParams.get('recordId'));
            if (recordId === null) {
                return NextResponse.json({ error: 'Invalid recordId' }, { status: 400 });
            }
            const listOwnerMedia = searchParams.get('gallery') === 'true'
                ? listGalleryForOwnerService
                : listMediaForOwnerService;
            const media = await listOwnerMedia({
                ownerTable, ownerId: recordId, ownerFact: searchParams.get('ownerFact'),
                requestedTreeId, requestedOwnerId, currentUserId: user.id,
            });
            return NextResponse.json({ media, count: media.length });
        }

        const media = await listMediaService({
          requestedTreeId, requestedOwnerId, currentUserId: user.id,
          personId: parseOptionalIdParam(personId, 'personId') ?? undefined,
          withPerson: searchParams.get('withPerson') === 'true',
          includeTagged: searchParams.get('includeTagged') === 'true',
        });
        return NextResponse.json({ media, count: media.length });
    } catch (error) {
        return handleApiError(error, 'Failed to fetch media');
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
        const media = await createMetadataMediaService({
            title: body.Title || null,
            format: body.Format || null,
            contentType: body.ContentType || null,
            isPrimary: body.IsPrimary === true,
            personId: parseOptionalIdParam(body.PersonId == null ? null : String(body.PersonId), 'PersonId'),
            caseId: parseOptionalIdParam(body.CaseId == null ? null : String(body.CaseId), 'CaseId'),
            ownerTable: body.OwnerTable == null ? null : String(body.OwnerTable),
            ownerRecordId: parseOptionalIdParam(
                body.OwnerRecordId == null ? null : String(body.OwnerRecordId),
                'OwnerRecordId',
            ),
            requestedTreeId: parseOptionalIdParam(searchParams.get('treeId'), 'treeId'),
            requestedOwnerId: parseOptionalIdParam(searchParams.get('ownerId'), 'ownerId'),
            currentUserId: user.id,
        });

        return NextResponse.json({ media }, { status: 201 });
    } catch (error) {
        return handleApiError(error, 'Failed to create media');
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { success } = rateLimit(
            `${user.id}:media-delete-bulk`,
            BULK_DELETE_RATE_LIMIT,
            BULK_DELETE_RATE_WINDOW_MS,
        );
        if (!success) {
            return NextResponse.json(
                { error: 'Too many media delete requests. Please try again later.' },
                { status: 429 },
            );
        }

        const { searchParams } = new URL(request.url);
        let body: unknown;
        try {
            body = await readJsonObject(request);
        } catch {
            throw new ValidationError('Request body must be valid JSON');
        }

        const ids = body !== null && typeof body === 'object'
            ? (body as { ids?: unknown }).ids
            : undefined;
        const result = await deleteMediaBatchService({
            requestedTreeId: parseStrictOptionalIdParam(searchParams.get('treeId'), 'treeId'),
            requestedOwnerId: parseStrictOptionalIdParam(searchParams.get('ownerId'), 'ownerId'),
            currentUserId: user.id,
            ids,
        });
        return NextResponse.json(result, { status: 200 });
    } catch (error) {
        return handleApiError(error, 'Failed to delete media');
    }
}
