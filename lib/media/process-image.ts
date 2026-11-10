/**
 * Browser image processor for the local-first build. Replaces the server's
 * native `sharp` pipeline (app/api/media/upload/route.ts compressImage): caps
 * raster images at 2048px, re-encodes to JPEG q85, and applies+strips EXIF
 * orientation via createImageBitmap. SVG and GIF pass through untouched (vector
 * / possibly-animated). BROWSER ONLY — never import from a route/server module.
 */

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

/** Content types returned unchanged (no canvas re-encode). */
export const SKIP_COMPRESSION_TYPES: ReadonlySet<string> = new Set(['image/svg+xml', 'image/gif']);

export interface ProcessedImage {
  bytes: Uint8Array;
  contentType: string;
  format: string;
  width: number;
  height: number;
}

function formatFromContentType(contentType: string): string {
  if (contentType === 'image/svg+xml') return 'SVG';
  if (contentType === 'image/gif') return 'GIF';
  return 'JPG';
}

export async function processForUpload(file: File): Promise<ProcessedImage> {
  if (SKIP_COMPRESSION_TYPES.has(file.type)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { bytes, contentType: file.type, format: formatFromContentType(file.type), width: 0, height: 0 };
  }

  // createImageBitmap applies EXIF orientation and gives natural dimensions.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { bytes, width, height } = await encodeBitmapToJpeg(bitmap, MAX_DIMENSION);
  return { bytes, contentType: 'image/jpeg', format: 'JPG', width, height };
}

/**
 * Downscale an already-decoded bitmap so its longest edge is `maxDim` (never
 * upscales) and re-encode to JPEG q85. Closes the bitmap. Shared by
 * `processForUpload` and `downscaleToThumb`.
 */
async function encodeBitmapToJpeg(
  bitmap: ImageBitmap,
  maxDim: number,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas 2D context unavailable');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new Error('Image encoding failed');

  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/**
 * Downscale already-stored image bytes to a thumbnail (longest edge = maxDim),
 * re-encoded JPEG q85. Returns null for vector/animated types (SVG/GIF) and for
 * PDF documents — callers fall back to the full blob for those. BROWSER ONLY — never import from a
 * route/server module.
 */
export async function downscaleToThumb(
  bytes: Uint8Array,
  contentType: string,
  maxDim = 256,
): Promise<{ bytes: Uint8Array; contentType: 'image/jpeg' } | null> {
  if (SKIP_COMPRESSION_TYPES.has(contentType) || contentType === 'application/pdf') return null;
  const blob = new Blob([bytes as BlobPart], { type: contentType });
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const { bytes: thumbBytes } = await encodeBitmapToJpeg(bitmap, maxDim);
  return { bytes: thumbBytes, contentType: 'image/jpeg' };
}
