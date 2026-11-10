import { defineConfig } from 'vitest/config';
import path from 'path';
import base from './vitest.config';

// The integration suite on PGlite, the engine the static and desktop builds run
// (#868). The same route and service tests run against an in-memory PGlite per
// file instead of Postgres: `@/lib/db/connection` resolves to the PGlite module,
// exactly as next.config.ts swaps it for build:static, and the setup file boots
// the database and seeds the two test users.
//
// DATABASE_URL is a sentinel so the suites' `hasTestDatabase()` gates open and a
// real database in .env.local can never be reached; nothing opens a pg pool.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/lib\/db\/connection$/, replacement: path.resolve(__dirname, 'lib/db/connection.pglite.ts') },
      { find: '@', replacement: path.resolve(__dirname, '.') },
    ],
  },
  test: {
    ...base.test,
    include: ['__tests__/integration/**/*.test.ts'],
    globalSetup: ['__tests__/setup/pglite-global-setup.ts'],
    setupFiles: ['__tests__/setup/pglite-engine.ts', '__tests__/setup/mock-auth.ts'],
    fileParallelism: true,
    env: { ...base.test?.env, DATABASE_URL: 'pglite://memory', TEST_DB_ENGINE: 'pglite' },
  },
});
