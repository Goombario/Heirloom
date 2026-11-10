import sharp from 'sharp';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export interface ColdThumbnailBenchmarkOptions {
  dataDir?: string;
  requestCount?: number;
  size?: number;
  sourceSize?: number;
}

export interface ColdThumbnailBenchmarkResult {
  coldMs: number;
  warmMs: number;
  requestCount: number;
  size: number;
  cacheHit: boolean;
}

const BENCHMARK_USER_ID = 9001;
const BENCHMARK_FILENAME = 'synthetic-2048.jpg';

export function parseBenchmarkSize(value: string | undefined): number {
  if (value === undefined) return 256;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('MEDIA_BENCHMARK_SIZE must be a positive integer');
  }
  return parsed;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

/**
 * Measure the hosted thumbnail cold path using only a generated synthetic JPEG.
 *
 * The benchmark intentionally sets DATA_DIR before importing the thumbnail
 * module. This keeps the module's filesystem behavior pointed at the temporary
 * fixture directory and makes the function safe to call from tests or a CLI.
 */
export async function runColdThumbnailBenchmark(
  options: ColdThumbnailBenchmarkOptions = {},
): Promise<ColdThumbnailBenchmarkResult> {
  const requestCount = positiveInteger(options.requestCount ?? 4, 'requestCount');
  const size = positiveInteger(options.size ?? 256, 'size');
  const sourceSize = positiveInteger(options.sourceSize ?? 4096, 'sourceSize');
  const ownsRoot = options.dataDir === undefined;
  const rootDir = options.dataDir ?? (await mkdtemp(path.join(os.tmpdir(), 'media-thumbnail-benchmark-root-')));
  const dataDir = await mkdtemp(path.join(rootDir, 'run-'));
  const previousDataDir = process.env.DATA_DIR;
  const mediaDir = path.join(dataDir, 'uploads', String(BENCHMARK_USER_ID), 'media');
  const originalPath = path.join(mediaDir, BENCHMARK_FILENAME);

  process.env.DATA_DIR = dataDir;

  try {
    // A solid, deterministic RGB source is large in pixels but contains no
    // private or user-provided data. The original bytes are what Sharp reads.
    const pixels = Buffer.alloc(sourceSize * sourceSize * 3, 128);
    const original = await sharp(pixels, {
      raw: { width: sourceSize, height: sourceSize, channels: 3 },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    await mkdir(mediaDir, { recursive: true });
    await writeFile(originalPath, original);

    // Import only after DATA_DIR is set so all thumbnail paths resolve inside
    // this benchmark's temporary storage root.
    const { getOrCreateThumbnail } = await import('../lib/media-thumbnail');
    const request = () =>
      getOrCreateThumbnail({
        originalPath,
        userId: BENCHMARK_USER_ID,
        filename: BENCHMARK_FILENAME,
        size,
        contentType: 'image/jpeg',
      });

    const coldStart = performance.now();
    await Promise.all(Array.from({ length: requestCount }, request));
    const coldMs = performance.now() - coldStart;

    const warmStart = performance.now();
    await Promise.all(Array.from({ length: requestCount }, request));
    const warmMs = performance.now() - warmStart;
    const cacheKey = createHash('sha256').update(BENCHMARK_FILENAME, 'utf8').digest('hex');
    const cacheHit = existsSync(path.join(mediaDir, '.thumbs', `${cacheKey}_${size}.jpg`));

    return { coldMs, warmMs, requestCount, size, cacheHit };
  } finally {
    // Remove only the synthetic fixture subtree. A caller-provided DATA_DIR
    // may contain unrelated data, so it is never recursively removed here.
    await rm(dataDir, { recursive: true, force: true });
    if (ownsRoot) await rm(rootDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
  }
}
