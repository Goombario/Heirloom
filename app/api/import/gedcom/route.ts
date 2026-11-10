import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { rateLimit } from '@/lib/rate-limit';
import { ValidationError } from '@/lib/validation';
import { AccessError } from '@/lib/data/errors';
import { parseIdParam } from '@/lib/utils/parse-id';
import { previewGedcomService, importGedcomService } from '@/lib/services/gedcom';

export async function POST(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const mode = (searchParams.get('mode') || 'overwrite') as 'overwrite' | 'merge';
        const dryRun = searchParams.get('dryRun') === 'true';
        const requestedTreeId = parseIdParam(searchParams.get('treeId'));
        const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

        // Preview is a read-only parse and is also used as the ZIP media safety
        // check immediately before an import. Keep it out of the destructive
        // import budget so repeated previews cannot strand a valid import with
        // HTTP 429 (especially after switching trees while testing).
        const rateKey = dryRun ? `${user.id}:import-preview` : `${user.id}:import`;
        const rateLimitMax = dryRun ? 30 : 5;
        const { success } = rateLimit(rateKey, rateLimitMax, 15 * 60 * 1000);
        if (!success) {
            return NextResponse.json({ error: 'Too many import requests. Please try again later.' }, { status: 429 });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const casesJsonField = formData.get('casesJson') as string | null;
        const mediaJsonField = formData.get('mediaJson') as string | null;
        const sourcesJsonField = formData.get('sourcesJson') as string | null;
        const placesJsonField = formData.get('placesJson') as string | null;
        const archiveManifestField = formData.get('archiveManifest') as string | null;
        let archiveManifest: string[] | undefined;
        if (archiveManifestField !== null) {
            let parsedManifest: unknown;
            try {
                parsedManifest = JSON.parse(archiveManifestField);
            } catch (parseErr) {
                throw new ValidationError(`archiveManifest is not valid JSON: ${(parseErr as Error).message}`);
            }
            if (!Array.isArray(parsedManifest) || !parsedManifest.every((entry) => typeof entry === 'string')) {
                throw new ValidationError('archiveManifest must be a JSON array of strings');
            }
            archiveManifest = parsedManifest;
        }

        if (dryRun) {
            const result = await previewGedcomService({
                file,
                mode,
                mediaJson: mediaJsonField,
                sourcesJson: sourcesJsonField,
                currentUserId: user.id,
            });
            return NextResponse.json(result);
        }

        const result = await importGedcomService({
            file,
            mode,
            casesJson: casesJsonField,
            mediaJson: mediaJsonField,
            sourcesJson: sourcesJsonField,
            placesJson: placesJsonField,
            archiveManifest,
            currentUserId: user.id,
            requestedTreeId,
            requestedOwnerId,
        });
        return NextResponse.json(result);

    } catch (error) {
        if (error instanceof ValidationError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error instanceof AccessError) {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }

        const errorId = `gedcom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const message = error instanceof Error ? error.message : String(error);

        if (
            message.includes('parseGedcom') ||
            message.toLowerCase().includes('invalid gedcom') ||
            message.toLowerCase().includes('malformed')
        ) {
            console.error(`[${errorId}] Invalid GEDCOM:`, error);
            return NextResponse.json(
                { error: `Invalid GEDCOM file: ${message}`, errorId },
                { status: 400 }
            );
        }

        const pgCode = typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : null;
        if (pgCode && pgCode.startsWith('23')) {
            console.error(`[${errorId}] GEDCOM import conflict (${pgCode}):`, error);
            // The raw constraint text names tables and keys; it stays in the log (#874).
            return NextResponse.json(
                { error: 'The file contains conflicting records and could not be imported.', errorId, code: pgCode },
                { status: 409 }
            );
        }

        console.error(`[${errorId}] Error importing GEDCOM:`, error);
        return NextResponse.json(
            { error: 'Failed to import GEDCOM file', errorId },
            { status: 500 }
        );
    }
}
