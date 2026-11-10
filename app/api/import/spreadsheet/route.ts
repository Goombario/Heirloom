import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { rateLimit } from '@/lib/rate-limit';
import { ValidationError } from '@/lib/validation';
import { AccessError } from '@/lib/data/errors';
import { parseIdParam } from '@/lib/utils/parse-id';
import { previewSpreadsheetService, importSpreadsheetService } from '@/lib/services/gedcom';

export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const confirm = searchParams.get('confirm') === 'true';

        // Preview writes nothing, so it has its own looser bucket: preview, fix the
        // sheet, preview again must not use up the imports (#1231).
        const { success, retryAfterMs } = confirm
            ? rateLimit(`${user.id}:spreadsheet-import`, 5, 15 * 60 * 1000)
            : rateLimit(`${user.id}:spreadsheet-preview`, 30, 15 * 60 * 1000);
        if (!success) {
            const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
            return NextResponse.json(
                { error: 'Too many import requests. Please try again later.', retryAfterSeconds },
                { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
            );
        }
        const rawFormat = searchParams.get('dateFormat');
        const dateFormat: 'MDY' | 'DMY' = rawFormat === 'DMY' ? 'DMY' : 'MDY';
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
        }

        if (!confirm) {
            const result = await previewSpreadsheetService({
                file,
                dateFormat,
                currentUserId: user.id,
                requestedTreeId,
                requestedOwnerId,
            });
            return NextResponse.json(result);
        }

        const result = await importSpreadsheetService({
            file,
            dateFormat,
            currentUserId: user.id,
            requestedTreeId,
            requestedOwnerId,
        });
        return NextResponse.json(result);

    } catch (err) {
        if (err instanceof ValidationError) {
            return NextResponse.json({ error: err.message }, { status: 400 });
        }
        if (err instanceof AccessError) {
            return NextResponse.json({ error: err.message }, { status: 403 });
        }
        throw err;
    }
}
