import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { rateLimit } from '@/lib/rate-limit';
import { parseOptionalIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { uploadMediaService } from '@/lib/services/media-upload';
import { validateUploadIntentId } from '@/lib/media/upload-intent';

/**
 * POST /api/media/upload — HTTP shell only. Auth, rate limiting, formData
 * extraction, and error→status mapping live here; all orchestration
 * (validation, ownership/scope checks, disk writes, quota, the create/link
 * sequence) is in `lib/services/media-upload.ts`.
 */
export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Rate limit: 1000 uploads per 15 minutes for interactive uploads.
        // Matches the import bucket above deliberately (#593): bulk album uploads
        // send one request per photo, and the old 100 ceiling 429'd legitimate
        // batches partway through. Every bucket here is keyed post-auth on a
        // private instance, so this is a runaway-loop guard, not an abuse control —
        // the per-tree storage quota (507) is the ceiling that actually binds.
        const { success } = rateLimit(`${user.id}:upload`, 1000, 15 * 60 * 1000);
        if (!success) {
            return NextResponse.json({ error: 'Too many upload requests. Please try again later.' }, { status: 429 });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const title = formData.get('title') as string | null;
        const isPrimary = formData.get('isPrimary') === 'true';
        const ownerTable = formData.get('ownerTable') as string | null;
        const ownerFact = formData.get('ownerFact') as string | null;
        const requestedOwnerId = parseOptionalIdParam(formData.get('ownerId') as string | null, 'ownerId');
        const requestedTreeId = parseOptionalIdParam(formData.get('treeId') as string | null, 'treeId');

        // Entity ids from form data: present-but-malformed is a client error
        // (ValidationError → 400 via handleApiError), not NaN-into-SQL
        // (which pg rejects as a 500).
        const personId = parseOptionalIdParam(formData.get('personId') as string | null, 'personId');
        const caseId = parseOptionalIdParam(formData.get('caseId') as string | null, 'caseId');
        const ownerRecordId = parseOptionalIdParam(formData.get('ownerRecordId') as string | null, 'ownerRecordId');
        const uploadIntentId = validateUploadIntentId(formData.get('uploadIntentId'));

        const media = await uploadMediaService({
            file, title, isPrimary, personId, caseId, ownerTable, ownerRecordId, ownerFact,
            requestedTreeId, requestedOwnerId, currentUserId: user.id, uploadIntentId,
        });

        return NextResponse.json({ media }, { status: 201 });
    } catch (error) {
        // A raw disk-full error (ENOSPC) from writeFile isn't a StorageLimitError;
        // map it to the same 507 with the operator-facing message.
        if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
            return NextResponse.json({ error: 'Storage limit reached. Please contact your administrator to free up space.' }, { status: 507 });
        }
        return handleApiError(error, 'Failed to upload media');
    }
}
