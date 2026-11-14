/**
 * Decodes, downscales and re-encodes photos off the page's main thread (#62),
 * with OffscreenCanvas. `process-image.ts` sends it work when the browser has
 * Worker and OffscreenCanvas, and does the same work on the page otherwise.
 */
import { encodeOnCanvas, type EncodeRequest, type EncodeResponse } from './image-encode';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<EncodeRequest>) => {
  const { id, blob, maxDim } = event.data;
  void (async () => {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const result = await encodeOnCanvas(bitmap, maxDim, (w, h) => new OffscreenCanvas(w, h));
      const reply: EncodeResponse = { id, ok: true, ...result };
      scope.postMessage(reply, [result.bytes.buffer]);
    } catch (err) {
      const reply: EncodeResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
      scope.postMessage(reply);
    }
  })();
});
