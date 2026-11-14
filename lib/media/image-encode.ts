/** Shared by the page and the image worker (#62). No DOM access of its own. */

const JPEG_QUALITY = 0.85;

export interface EncodeRequest { id: number; blob: Blob; maxDim: number }
export type EncodeResponse =
  | { id: number; ok: true; bytes: Uint8Array; width: number; height: number }
  | { id: number; ok: false; error: string };

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

async function canvasToJpeg(canvas: AnyCanvas): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
}

/**
 * Downscale a decoded bitmap so its longest edge is `maxDim` (never upscales)
 * and re-encode it as JPEG q85. Closes the bitmap.
 */
export async function encodeOnCanvas(
  bitmap: ImageBitmap,
  maxDim: number,
  makeCanvas: (width: number, height: number) => AnyCanvas,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas 2D context unavailable');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvasToJpeg(canvas);
  if (!blob) throw new Error('Image encoding failed');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}
