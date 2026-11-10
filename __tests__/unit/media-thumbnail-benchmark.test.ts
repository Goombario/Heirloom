import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parseBenchmarkSize,
  runColdThumbnailBenchmark,
} from '@/scripts/benchmark-media-thumbnails';

describe('synthetic hosted thumbnail benchmark', () => {
  it('parses a positive benchmark size and defaults to 256px', () => {
    expect(parseBenchmarkSize(undefined)).toBe(256);
    expect(parseBenchmarkSize('2048')).toBe(2048);
    expect(() => parseBenchmarkSize('0')).toThrow(
      'MEDIA_BENCHMARK_SIZE must be a positive integer',
    );
    expect(() => parseBenchmarkSize('nope')).toThrow(
      'MEDIA_BENCHMARK_SIZE must be a positive integer',
    );
  });

  it('measures four cold 256px requests, proves a cache hit, and confines cleanup to a unique run directory', async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), 'media-thumbnail-benchmark-parent-'));
    const dataDir = path.join(parentDir, 'data');
    await mkdir(dataDir);
    const sentinelPath = path.join(parentDir, 'outside-data-dir.txt');
    await writeFile(sentinelPath, 'must remain untouched');
    const stalePath = path.join(dataDir, 'uploads', '9001', 'media', '.thumbs', 'stale.jpg');
    await mkdir(path.dirname(stalePath), { recursive: true });
    await writeFile(stalePath, 'stale cache must remain untouched');

    try {
      const result = await runColdThumbnailBenchmark({
        dataDir,
        requestCount: 4,
        size: 256,
      });

      expect(Number.isFinite(result.coldMs)).toBe(true);
      expect(Number.isFinite(result.warmMs)).toBe(true);
      expect(result.requestCount).toBe(4);
      expect(result.size).toBe(256);
      expect(result.cacheHit).toBe(true);
      expect(existsSync(sentinelPath)).toBe(true);
      await expect(readFile(sentinelPath, 'utf8')).resolves.toBe('must remain untouched');
      await expect(readFile(stalePath, 'utf8')).resolves.toBe('stale cache must remain untouched');
      await expect(readdir(parentDir)).resolves.toEqual(['data', 'outside-data-dir.txt']);
      await expect(readdir(dataDir)).resolves.toEqual(['uploads']);
    } finally {
      // The benchmark owns its DATA_DIR contents, while the test owns this parent.
      // Removing the parent here keeps the test isolated without allowing the
      // benchmark to touch paths outside the temporary DATA_DIR.
      const { rm } = await import('node:fs/promises');
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it('measures a cacheable 2048px hero request from a larger synthetic source', async () => {
    const result = await runColdThumbnailBenchmark({ size: 2048 });

    expect(Number.isFinite(result.coldMs)).toBe(true);
    expect(Number.isFinite(result.warmMs)).toBe(true);
    expect(result.requestCount).toBe(4);
    expect(result.size).toBe(2048);
    expect(result.cacheHit).toBe(true);
  });
});
