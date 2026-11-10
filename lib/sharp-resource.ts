import sharp from 'sharp';

/** Maximum decoded pixels accepted from any untrusted hosted image. */
export const SHARP_MAX_INPUT_PIXELS = 64_000_000;

const MAX_CONCURRENT_SHARP = 2;
let activeSharp = 0;
const sharpQueue: Array<() => void> = [];

/** Run one Sharp operation under the process-wide server resource gate. */
export async function withSharpSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeSharp >= MAX_CONCURRENT_SHARP) {
    await new Promise<void>((resolve) => sharpQueue.push(resolve));
  } else {
    activeSharp++;
  }
  try {
    return await fn();
  } finally {
    const next = sharpQueue.shift();
    if (next) next();
    else activeSharp--;
  }
}

/** Create a Sharp pipeline with the explicit hosted decoded-pixel ceiling. */
export function sharpForUntrustedInput(input: Buffer): ReturnType<typeof sharp> {
  return sharp(input, { limitInputPixels: SHARP_MAX_INPUT_PIXELS });
}
