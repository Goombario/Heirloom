import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  test: {
    include: ['scripts/benchmark-media-thumbnails.vitest.ts', 'scripts/perf/bench-services.vitest.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
  },
});
