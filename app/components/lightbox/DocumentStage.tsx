'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Loader2 } from '@/lib/icons';
import { useMediaUrl } from '@/lib/media/useMediaUrl';
import { namedPdfUrl } from '@/lib/media-url';
import { usePdfPreview } from '@/app/components/media/DocumentThumb';

/** Whether this browser shows PDFs itself; phones and some webviews hand them off instead. */
function hasPdfViewer(): boolean {
    return typeof navigator !== 'undefined' && navigator.pdfViewerEnabled !== false;
}

/**
 * A PDF document on the lightbox stage (#510).
 *
 * Desktop: the browser's own PDF viewer in a frame, which brings paging, zoom,
 * search and print; the app adds nothing inside it. The file route serves PDFs
 * without the sandbox images get, because Chrome's viewer won't run sandboxed.
 *
 * Phone, or a browser with no viewer: the first page fills the width, with an
 * Open PDF button that hands the file to the device's own viewer.
 *
 * Only the active slide mounts a frame; its neighbours show the first page so a
 * swipe never loads three documents at once.
 */
export default function DocumentStage({
    mediaId, treeId, title, active, phone, box, gutter,
}: {
    mediaId: number;
    treeId: number | null;
    title: string;
    active: boolean;
    phone: boolean;
    /** The stage's measured size, or null before the first measure. */
    box: { w: number; h: number } | null;
    gutter: number;
}) {
    const t = useTranslations('documents');
    const [viewer] = useState(hasPdfViewer);
    const framed = active && !phone && viewer;
    const media = useMediaUrl(mediaId, { treeId });
    // The viewer's toolbar names the file after its URL, so give it the title.
    const file = { src: media.src && namedPdfUrl(media.src, title) };
    const { preview, failed } = usePdfPreview(mediaId, treeId, 768);
    const label = title || t('pdf_document');

    if (framed) {
        const h = box ? box.h : 640;
        const w = box ? box.w - gutter * 2 : 600;
        return file.src ? (
            <iframe
                src={file.src}
                title={label}
                data-testid="document-frame"
                className="block rounded-[8px] border-0 bg-[#525659] shadow-[0_12px_40px_rgba(0,0,0,.45)]"
                style={{ width: w, height: h }}
            />
        ) : (
            <div className="grid place-items-center text-white/60" style={{ width: w, height: h }}>
                <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
            </div>
        );
    }

    const maxH = box ? box.h - (active ? 72 : 0) : 520;
    return (
        <div className="flex flex-col items-center gap-4 leading-normal" style={{ width: box ? box.w - gutter * 2 : '100%' }}>
            {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={preview.url}
                    alt={active ? label : ''}
                    className="block w-auto h-auto bg-white shadow-[0_8px_24px_rgba(0,0,0,.45)]"
                    style={{ maxWidth: '100%', maxHeight: maxH }}
                />
            ) : failed ? (
                <span role="img" aria-label={label} className="grid place-items-center w-40 h-52 rounded-md bg-white/10 text-white/60">
                    <FileText className="w-12 h-12" aria-hidden="true" />
                </span>
            ) : (
                <Loader2 className="w-6 h-6 animate-spin text-white/60" aria-hidden="true" />
            )}
            {active && file.src && (
                <a
                    href={file.src}
                    target="_blank"
                    rel="noopener"
                    data-testid="document-open"
                    className="inline-flex items-center gap-2 min-h-11 px-4 rounded-full bg-white/12 border border-white/25 text-white text-sm font-medium no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-on-dark"
                >
                    <FileText className="w-4 h-4" aria-hidden="true" />
                    {preview ? t('open_pdf_pages', { count: preview.pageCount }) : t('open_pdf')}
                </a>
            )}
        </div>
    );
}
