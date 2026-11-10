import { defineConfig } from 'vitest/config';
import path from 'path';
import { readFileSync, existsSync } from 'fs';

// Load env files for tests. Prefers .env.test.local (test DB) over .env.local (dev DB).
// To run integration tests locally, create .env.test.local with a separate test DATABASE_URL.
function loadTestEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  // Load .env.local first (base), then .env.test.local overrides it
  for (const filename of ['.env.local', '.env.test.local']) {
    const envPath = path.resolve(__dirname, filename);
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const match = line.match(/^([^#=\s][^=]*)=(.*)/);
      if (match) env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const testEnv = loadTestEnv();
// Force DESKTOP_MODE off for tests — local .env.local often sets it to true
// for desktop dev, but it disables auth checks + storage-quota checks that
// integration tests need to exercise.
testEnv.DESKTOP_MODE = 'false';
// Likewise blank a local DATA_DIR (empty falls back to ./data, as on CI): tests
// must never touch the real data directory, and the ones that need one point
// DATA_DIR at their own temp dir.
testEnv.DATA_DIR = '';
// Make vars available to globalSetup (runs in main process)
Object.assign(process.env, testEnv);

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
    globalSetup: ['__tests__/setup/global-setup.ts'],
    setupFiles: ['__tests__/setup/mock-auth.ts'],
    testTimeout: 10000,
    pool: 'forks',
    fileParallelism: false,  // Integration tests share a DB — run files sequentially to avoid cleanup interference
    env: testEnv,  // Pass vars to forked worker processes
  },
});
