import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { getMediaById } from '@/lib/db/queries/media';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { parseIdParam } from '@/lib/utils/parse-id';
import path from 'path';
import { getDataDir } from '@/lib/data-dir';
import { isValidThumbSize } from '@/lib/media-url';
import { getOrCreateThumbnail } from '@/lib/media-thumbnail';
import { readHostedOriginal } from '@/lib/media-original';
import { isPdfMedia } from '@/lib/media/allowed-extensions';
import { mediaContentDisposition } from '@/lib/media/content-disposition';

/**
 * GET /api/media/[id]/file - Serve media file with authentication
 * Only serves files if user owns the media or has access via sharing.
 * `?download=1` asks for an attachment instead of inline display.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const resolvedParams = await params;
        const mediaId = parseIdParam(resolvedParams.id);

        if (mediaId === null) {
            return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);

        const wParam = searchParams.get('w');
        let requestedWidth: number | null = null;
        if (wParam !== null) {
            const w = Number(wParam);
            if (!/^\d+$/.test(wParam) || !isValidThumbSize(w)) {
                return NextResponse.json({ error: 'Invalid width parameter' }, { status: 400 });
            }
            requestedWidth = w;
        }

        const scope = await resolveTreeScope(
            { treeId: parseIdParam(searchParams.get('treeId')), ownerId: parseIdParam(searchParams.get('ownerId')) },
            user.id
        );

        const media = await getMediaById(mediaId, scope.treeId);

        if (!media) {
            return NextResponse.json({ error: 'Media not found' }, { status: 404 });
        }

        if (!media.FilePath) {
            return NextResponse.json({ error: 'Media file path not found' }, { status: 404 });
        }

        const filename = path.basename(media.FilePath);
        const filePath = path.join(
            getDataDir(),
            'uploads',
            media.UserId.toString(),
            'media',
            filename
        );

        const originalContentType = media.ContentType || 'application/octet-stream';
        const isPdf = isPdfMedia(media);
        const cacheHeaders = {
            'Cache-Control': 'private, max-age=604800, immutable',
            'Content-Disposition': mediaContentDisposition({ Title: media.Title, FilePath: media.FilePath }, searchParams.get('download') === '1'),
            // Harden served user uploads (esp. SVG, which can embed <script>).
            // `sandbox` with no allow-scripts blocks script execution when the file
            // is opened as a top-level document; default-src 'none' stops it fetching
            // any sub-resource; nosniff stops a non-image being MIME-sniffed into
            // active content. Inline <img src> rendering is unaffected. (finding 14 §3)
            //
            // A PDF (#510) is shown by the browser's own viewer, framed by the media
            // viewer. Browsers refuse to run that viewer in a sandboxed document, so a
            // PDF gets no sandbox; its stored bytes passed the %PDF- signature check
            // and nosniff keeps it a PDF. Only this app's own pages may frame it.
            // next.config.ts leaves this route out of its app-wide frame headers.
            'Content-Security-Policy': isPdf
                ? "frame-ancestors 'self'"
                : "default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'",
            'X-Frame-Options': isPdf ? 'SAMEORIGIN' : 'DENY',
            'X-Content-Type-Options': 'nosniff',
        };

        if (requestedWidth !== null) {
            // A document has no image thumbnail; the client draws its first page.
            if (isPdf) {
                return NextResponse.json({ error: 'Documents have no thumbnail' }, { status: 415 });
            }
            const { buffer, contentType } = await getOrCreateThumbnail({
                originalPath: filePath,
                userId: media.UserId,
                filename,
                size: requestedWidth,
                contentType: originalContentType,
            });
            return new NextResponse(buffer, {
                headers: { 'Content-Type': contentType, ...cacheHeaders },
            });
        }

        const fileBuffer = await readHostedOriginal({
            mediaDir: path.dirname(filePath), filename,
        });
        return new NextResponse(fileBuffer, {
            headers: { 'Content-Type': originalContentType, ...cacheHeaders },
        });
    } catch (error: unknown) {
        if (error instanceof Error && error.message.includes('Access denied')) {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        console.error('Serve media file error:', error);

        if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
        }

        return NextResponse.json({ error: 'Failed to serve media file' }, { status: 500 });
    }
}
