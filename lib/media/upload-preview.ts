import { PDF_CONTENT_TYPE } from './allowed-extensions';
import { downscaleToThumb } from './process-image';

/**
 * Build a best-effort bounded upload preview from bytes already read by the
 * duplicate scan. Preview failures are deliberately non-fatal: the caller
 * keeps showing the original File URL in that case. A PDF (#510) previews as
 * its first page, drawn by pdf.js, which loads only when one is picked.
 */
export async function createUploadPreview(
  bytes: Uint8Array,
  contentType: string,
): Promise<Blob | null> {
  try {
    if (contentType === PDF_CONTENT_TYPE) {
      const { renderPdfFirstPage } = await import('./pdf-preview');
      const page = await renderPdfFirstPage({ data: bytes }, 256);
      URL.revokeObjectURL(page.url);
      return page.blob;
    }
    const thumb = await downscaleToThumb(bytes, contentType, 256);
    return thumb ? new Blob([thumb.bytes as BlobPart], { type: 'image/jpeg' }) : null;
  } catch {
    return null;
  }
}
