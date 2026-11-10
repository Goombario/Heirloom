import { expect, test } from 'vitest';
import {
  parseBenchmarkSize,
  runColdThumbnailBenchmark,
} from './benchmark-media-thumbnails';

test('runs the synthetic media-thumbnail benchmark', async () => {
  const result = await runColdThumbnailBenchmark({
    size: parseBenchmarkSize(process.env.MEDIA_BENCHMARK_SIZE),
  });
  expect(result.cacheHit).toBe(true);
  process.stdout.write(`MEDIA_THUMBNAIL_BENCHMARK ${JSON.stringify(result)}\n`);
});
