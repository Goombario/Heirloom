'use client';

/**
 * First-page previews of PDF documents (#510), drawn in the browser with pdf.js.
 *
 * Neither build can draw a PDF where it stores one: the hosted server has sharp,
 * which reads images only, and the local build keeps bytes in PGlite. So a
 * document's tile, the phone viewer's page and the upload preview all come from
 * here, in both data modes, and the page count rides along for the captions.
 *
 * pdf.js and its worker load only when the first document is drawn. Results are
 * cached per media, tree and width for the session; a few draws run at a time so
 * a grid of documents doesn't parse every file at once.
 */

import { DATA_MODE, getDataClient } from '@/lib/data';
import { mediaFileUrl } from '@/lib/media-url';

export interface PdfPreview {
  /** Object URL of the first page as a JPEG. */
  url: string;
  /** The JPEG itself, for a caller that keeps its own URL. */
  blob: Blob;
  pageCount: number;
  /** The drawn page's size in px, for an aspect ratio before it loads. */
  width: number;
  height: number;
}

type PdfJs = typeof import('pdfjs-dist');

let pdfjsLoad: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsLoad ??= import('pdfjs-dist').then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      // Served from this origin, so the CSP's worker-src 'self' covers it.
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(
        new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
        { type: 'module' },
      );
    }
    return pdfjs;
  }).catch((error: unknown) => {
    pdfjsLoad = null;
    throw error;
  });
  return pdfjsLoad;
}

const SLOTS = 2;
let running = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  while (running >= SLOTS) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/**
 * Draw page one of a PDF at `width` CSS px (times the screen's pixel ratio, up
 * to 2) and count its pages. Throws when pdf.js can't read the file, such as an
 * encrypted or damaged PDF; callers show a plain document icon then.
 */
export async function renderPdfFirstPage(
  source: { data: Uint8Array } | { url: string },
  width: number,
): Promise<PdfPreview> {
  const pdfjs = await loadPdfJs();
  return withSlot(async () => {
    // pdf.js moves `data` into its worker; copy so the caller's bytes stay usable.
    const task = pdfjs.getDocument('data' in source
      ? { data: source.data.slice(), stopAtErrors: false }
      : { url: source.url, stopAtErrors: false });
    try {
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const ratio = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width * ratio) / natural.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) throw new Error('PDF page encoding failed');
      return { url: URL.createObjectURL(blob), blob, pageCount: doc.numPages, width: canvas.width, height: canvas.height };
    } finally {
      await task.destroy();
    }
  });
}

const CACHE_LIMIT = 120;
const cache = new Map<string, Promise<PdfPreview>>();

/** The stored file's bytes or URL, whichever this build reads documents from. */
async function mediaSource(mediaId: number, treeId: number | null): Promise<{ data: Uint8Array } | { url: string }> {
  if (DATA_MODE === 'http') return { url: mediaFileUrl(mediaId, { treeId }) };
  const client = await getDataClient();
  return { data: (await client.media.getFile(mediaId, treeId)).bytes };
}

/** A stored document's first page and page count, drawn once per session. */
export function loadPdfPreview(mediaId: number, treeId: number | null, width: number): Promise<PdfPreview> {
  const key = `${mediaId}:${treeId ?? 'default'}:${width}`;
  const hit = cache.get(key);
  if (hit) {
    // Refresh its place, so the oldest unused preview is the one let go.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const load = mediaSource(mediaId, treeId).then((source) => renderPdfFirstPage(source, width));
  // A failure isn't kept: the next look tries again.
  load.catch(() => { if (cache.get(key) === load) cache.delete(key); });
  cache.set(key, load);
  while (cache.size > CACHE_LIMIT) {
    const [oldestKey, oldest] = cache.entries().next().value as [string, Promise<PdfPreview>];
    cache.delete(oldestKey);
    void oldest.then((preview) => URL.revokeObjectURL(preview.url), () => undefined);
  }
  return load;
}
