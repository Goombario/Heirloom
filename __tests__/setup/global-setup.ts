import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { writeTestUserIds } from './test-user-ids';
import { buildEmptyClusterSnapshotIfMissing } from './pglite-snapshot';

// Load env files since globalSetup runs in an isolated context in Vitest 4.
// .env.test.local takes priority over .env.local so tests can use a separate DB.
function loadTestEnv() {
  for (const filename of ['.env.local', '.env.test.local']) {
    const envPath = path.resolve(process.cwd(), filename);
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const match = line.match(/^([^#=\s][^=]*)=(.*)/);
      if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}
loadTestEnv();

/**
 * Global setup for integration tests.
 * Initializes the test database schema and seeds test users.
 * Runs once before all test files.
 */
export async function setup() {
  // Build the empty-cluster PGlite snapshot once (build-if-missing, cached in
  // node_modules/.cache) so the PGlite-backed unit files each skip `initdb`.
  // Runs before the DB-seeding below so the unit tier (no DATABASE_URL) still
  // gets it. On CI each job builds its own copy, which takes about a second.
  await buildEmptyClusterSnapshotIfMissing();

  // `npm run verify` runs the unit tier beside the integration tier. Only the
  // latter sets up Postgres, so the two schema inits never race.
  if (process.env.SKIP_TEST_DB_SETUP === '1') {
    console.log('SKIP_TEST_DB_SETUP set — skipping integration test DB setup');
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log('DATABASE_URL not set — skipping integration test DB setup');
    return;
  }

  const pool = new Pool({ connectionString });

  try {
    // Import and run schema initialization
    const { initializeSchema } = await import('../../lib/db/init-schema');
    await initializeSchema(pool);

    // Seed test users (idempotent). RETURNING surfaces the Id even on conflict
    // because we use DO UPDATE rather than DO NOTHING — required so test-helpers
    // and mock-auth use the real DB Id (not a hardcoded 1) when the dev DB
    // already has other users at lower Ids.
    const user1 = await pool.query<{ Id: number }>(`
      INSERT INTO "Users" ("Email", "Name", "GoogleId")
      VALUES ('test@example.com', 'Test User', 'google-test-123')
      ON CONFLICT ("Email") DO UPDATE SET "Name" = EXCLUDED."Name"
      RETURNING "Id"
    `);
    const user2 = await pool.query<{ Id: number }>(`
      INSERT INTO "Users" ("Email", "Name", "GoogleId")
      VALUES ('other@example.com', 'Other User', 'google-other-456')
      ON CONFLICT ("Email") DO UPDATE SET "Name" = EXCLUDED."Name"
      RETURNING "Id"
    `);

    writeTestUserIds({ user1: user1.rows[0].Id, user2: user2.rows[0].Id });

    console.log(`Test database initialized — seeded users at Ids ${user1.rows[0].Id}, ${user2.rows[0].Id}`);
  } finally {
    await pool.end();
  }
}

export async function teardown() {
  // Nothing to clean up — CI ephemeral DB handles this
}
