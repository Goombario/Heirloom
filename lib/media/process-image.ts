/**
 * Browser image processor for the local-first build. Replaces the server's
 * native `sharp` pipeline (app/api/media/upload/route.ts compressImage): caps
 * raster images at 2048px, re-encodes to JPEG q85, and applies+strips EXIF
 * orientation via createImageBitmap. SVG and GIF pass through untouched (vector
 * / possibly-animated). BROWSER ONLY — never import from a route/server module.
 */

import { encodeOnCanvas, type EncodeResponse } from './image-encode';

const MAX_DIMENSION = 2048;

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

  const { bytes, width, height } = await encodeImage(file, MAX_DIMENSION);
  return { bytes, contentType: 'image/jpeg', format: 'JPG', width, height };
}

// One worker for the page's photo work, started on first use (#62).
let worker: Worker | null = null;
let workerBroken = false;
let nextId = 0;
const waiting = new Map<number, { resolve: (r: { bytes: Uint8Array; width: number; height: number }) => void; reject: (e: Error) => void }>();

function imageWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./image-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.addEventListener('message', (event: MessageEvent<EncodeResponse>) => {
    const reply = event.data;
    const job = waiting.get(reply.id);
    if (!job) return;
    waiting.delete(reply.id);
    if (reply.ok) job.resolve({ bytes: reply.bytes, width: reply.width, height: reply.height });
    else job.reject(new Error(reply.error));
  });
  worker.addEventListener('error', () => {
    // A worker that can't start (an old WebView without module workers) hands
    // everything waiting, and everything after, back to the page.
    workerBroken = true;
    worker?.terminate();
    worker = null;
    for (const job of waiting.values()) job.reject(new WorkerUnavailable());
    waiting.clear();
  });
  return worker;
}

class WorkerUnavailable extends Error {}

/**
 * Decode, downscale and re-encode an image, in the image worker where the
 * browser has one, else on the page. createImageBitmap applies EXIF
 * orientation and gives natural dimensions.
 */
async function encodeImage(blob: Blob, maxDim: number): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const w = imageWorker();
  if (w) {
    try {
      return await new Promise((resolve, reject) => {
        const id = ++nextId;
        waiting.set(id, { resolve, reject });
        w.postMessage({ id, blob, maxDim });
      });
    } catch (err) {
      if (!(err instanceof WorkerUnavailable)) throw err;
    }
  }
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  return encodeOnCanvas(bitmap, maxDim, (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  });
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
  const { bytes: thumbBytes } = await encodeImage(blob, maxDim);
  return { bytes: thumbBytes, contentType: 'image/jpeg' };
}
