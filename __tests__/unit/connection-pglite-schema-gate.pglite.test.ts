import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { SCHEMA_VERSION } from '@/lib/db/init-schema';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

// These tests DELIBERATELY boot a fresh PGlite per test: they drop tables and
// re-inject the SAME db to verify the schema-init gate skips re-running init
// when the persisted version is current. A shared beforeAll instance would
// defeat what they assert, so they live in their own file (own forked process)
// where the global __setTestDb state can't leak into the shared-boot tests.
let db: PGlite;

beforeEach(async () => {
  db = await newEmptyClusterDb(); // in-memory; no Worker/WASM-in-jsdom needed
  __setTestDb(db);
});

afterEach(async () => {
  __setTestDb(null);
  await db.close();
});

describe('connection.pglite schema-init gate', () => {
  // The static build re-creates the connection on every page hard-load, so
  // ensureSchema must skip the ~80-statement init when the persisted DB is
  // already at the current SCHEMA_VERSION. Re-injecting the SAME in-memory db
  // (via __setTestDb, which resets the lazy dbPromise) simulates a fresh load
  // against a persisted database.

  it('records the schema version after the first init', async () => {
    await query('SELECT 1'); // triggers init
    const res = await query('SELECT "Version" FROM "_SchemaMeta"');
    expect(res.rows).toEqual([{ Version: SCHEMA_VERSION }]);
  });

  it('skips re-running init when the stored version is current', async () => {
    await query('SELECT 1'); // first init records the version
    // CASCADE: Sources."RepositoryId" FK now depends on Repository (Slice 4). A
    // re-init would recreate the Repository table; we assert it stays dropped.
    await query('DROP TABLE "Repository" CASCADE');

    __setTestDb(db); // simulate a fresh page load against the same persisted db
    await query('SELECT 1');

    const res = await query(`SELECT to_regclass('"Repository"') IS NOT NULL AS ok`);
    expect(res.rows[0]).toEqual({ ok: false }); // still gone → init was skipped
  });

  it('re-runs init when the version marker is missing', async () => {
    await query('SELECT 1');
    await query('DROP TABLE "Repository" CASCADE');
    await query('DELETE FROM "_SchemaMeta"'); // marker gone → must re-init

    __setTestDb(db);
    await query('SELECT 1');

    const res = await query(`SELECT to_regclass('"Repository"') IS NOT NULL AS ok`);
    expect(res.rows[0]).toEqual({ ok: true }); // recreated → init ran again
  });
});
