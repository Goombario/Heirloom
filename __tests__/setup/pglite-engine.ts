import { __setTestDb, query } from '@/lib/db/connection.pglite';
import { newEmptyClusterDb } from './pglite-snapshot';

// Per-file database for the integration suite on PGlite (vitest.pglite.config.ts).
// The first query runs the real schema init behind the `_SchemaMeta` gate, as the
// static build does; the users match global-setup.ts's seed.
__setTestDb(await newEmptyClusterDb());
await query(
  `INSERT INTO "Users" ("Email", "Name", "GoogleId") VALUES
     ('test@example.com', 'Test User', 'google-test-123'),
     ('other@example.com', 'Other User', 'google-other-456')`,
);
const seeded = await query(`SELECT "Id" FROM "Users" WHERE "Email" IN ('test@example.com', 'other@example.com') ORDER BY "Id"`);
if (seeded.rows.map((r: { Id: number }) => r.Id).join() !== '1,2') {
  throw new Error(`pglite-engine: expected test users at Ids 1 and 2, got ${JSON.stringify(seeded.rows)}`);
}
