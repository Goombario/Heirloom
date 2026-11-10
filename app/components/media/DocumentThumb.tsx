'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Loader2 } from '@/lib/icons';
import { loadPdfPreview, type PdfPreview } from '@/lib/media/pdf-preview';

/**
 * A stored PDF's first page and page count (#510), or null while it is drawn.
 * `failed` turns true when pdf.js can't read the file, such as an encrypted one.
 * `enabled` false skips the work, for a caller that may be showing a photo.
 */
export function usePdfPreview(mediaId: number, treeId: number | null | undefined, width: number, enabled = true): {
  preview: PdfPreview | null;
  failed: boolean;
} {
  const key = `${mediaId}:${treeId ?? null}:${width}`;
  const [state, setState] = useState<{ key: string; preview: PdfPreview | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadPdfPreview(mediaId, treeId ?? null, width)
      .then((preview) => { if (live) setState({ key, preview, failed: false }); })
      .catch(() => { if (live) setState({ key, preview: null, failed: true }); });
    return () => { live = false; };
  }, [key, mediaId, treeId, width, enabled]);
  const current = state?.key === key ? state : null;
  return { preview: current?.preview ?? null, failed: current?.failed ?? false };
}

/** A tile's widths draw the page this wide; larger requests get a sharper page. */
function drawWidth(width: number | undefined): number {
  return width != null && width <= 256 ? 256 : 768;
}

/**
 * "N pages" for a document's caption, read from the tile's own preview so it
 * costs no second parse. Nothing until it is known, or when pdf.js can't read it.
 */
export function DocumentPageCount({ mediaId, treeId, width = 256, prefix = '' }: {
  mediaId: number;
  treeId?: number | null;
  width?: number;
  /** Shown before the count, such as a caption's separator, only once there is one. */
  prefix?: string;
}) {
  const t = useTranslations('documents');
  const { preview } = usePdfPreview(mediaId, treeId, drawWidth(width));
  return preview ? <>{prefix}{t('pages', { count: preview.pageCount })}</> : null;
}

/**
 * A document where a photo would be (#510): its first page on the card-alt
 * ground, with a small PDF mark at tile sizes. A PDF pdf.js can't read shows a
 * plain document icon instead, so a tile never looks broken.
 */
export default function DocumentThumb({
  mediaId, treeId, width, alt, className, style, mark = (width ?? 256) >= 200,
}: {
  mediaId: number;
  treeId?: number | null;
  /** The width hint the photo would have asked for; small tiles drop the mark. */
  width?: number;
  alt: string;
  className?: string;
  style?: CSSProperties;
  mark?: boolean;
}) {
  const t = useTranslations('documents');
  const { preview, failed } = usePdfPreview(mediaId, treeId, drawWidth(width));
  return (
    <div
      role="img"
      aria-label={alt || t('pdf_document')}
      className={`${className ?? ''} relative flex items-center justify-center overflow-hidden bg-[color:var(--card-alt)]`}
      // A photo's object-fit has no meaning for the box around a page.
      style={{ ...style, objectFit: undefined }}
    >
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview.url} alt="" className="block max-h-[82%] max-w-[82%] w-auto h-auto shadow-[0_1px_2px_rgba(0,0,0,.18),0_6px_14px_rgba(0,0,0,.10)]" />
      ) : failed ? (
        <FileText className="h-1/3 max-h-12 w-auto text-text-muted" aria-hidden="true" />
      ) : (
        <Loader2 size={18} className="animate-spin text-text-muted" aria-hidden="true" />
      )}
      {mark && (
        <span aria-hidden="true" className="absolute right-1.5 bottom-1.5 rounded-[4px] bg-[color:var(--color-media-scrim)] px-1.5 py-0.5 text-xs font-semibold tracking-wide text-on-media">{t('pdf')}</span>
      )}
    </div>
  );
}
