import { defineConfig } from 'vitest/config';
import path from 'node:path';

// The GEDCOM interop probe (#810, #869): a measurement, not a test. It reads the
// gitignored test-data/vendor/ corpus that scripts/audit/fetch-vendor-gedcoms.mjs
// downloads, so it never runs in CI.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  test: {
    include: ['scripts/audit/gedcom-interop-probe.vitest.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
