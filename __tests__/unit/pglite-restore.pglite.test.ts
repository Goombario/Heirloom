import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { __setTestDb, dumpDatabase, validateDump } from '@/lib/db/connection.pglite';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

/**
 * Validates the whole-DB backup/restore mechanism and — crucially — the safety
 * property: a corrupt backup is rejected BEFORE any existing data is cleared.
 * The IndexedDB delete/reload/rollback in loadDatabase() is browser-only and is
 * exercised end-to-end in the app; here we cover the node-testable core.
 */

// Seeds the REAL app schema (not a hand-written stand-in) so a change to
// lib/db/init-schema.ts can actually break this test — see task-7 brief.
async function seedRealSchema(db: PGlite): Promise<void> {
  const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
  await initializeSchema(executor);
  await db.query(
    'INSERT INTO "Users" ("Id","Email","GoogleId") VALUES ($1,$2,$3)',
    [1, 'restore@test.local', 'google-restore'],
  );
  await db.query('INSERT INTO "Trees" ("Id","OwnerId","Name") VALUES ($1,$2,$3)', [1, 1, 'T']);
  await db.query(
    'INSERT INTO "People" ("UserId","TreeId","FirstName","LastName") VALUES ($1,$2,$3,$4)',
    [1, 1, 'Restore', 'Fixture'],
  );
}

describe('pglite backup dump + restore validation', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    // First dump triggers the real schema init via getDb()/ensureSchema; then seed
    // a neutral probe table (avoids colliding with the app schema's "People").
    await dumpDatabase();
    await db.exec(`CREATE TABLE _probe ("Id" int PRIMARY KEY, "Name" text);`);
    await db.exec(`INSERT INTO _probe VALUES (1, 'Ada'), (2, 'Grace');`);
    // Also seed real-schema fixture rows so the round-trip test below can assert
    // real app data (not just the neutral probe table) survives dump/restore.
    await seedRealSchema(db);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close().catch(() => {});
  });

  it('dumpDatabase() produces a non-empty tar blob', async () => {
    const blob = await dumpDatabase();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('a dump round-trips: loading it into a fresh PGlite restores the data', async () => {
    const blob = await dumpDatabase();
    const restored = await PGlite.create({ loadDataDir: blob });
    try {
      const res = await restored.query<{ Name: string }>('SELECT "Name" FROM _probe ORDER BY "Id"');
      expect(res.rows.map((r) => r.Name)).toEqual(['Ada', 'Grace']);

      const people = await restored.query<{ FirstName: string }>(
        'SELECT "FirstName" FROM "People" WHERE "TreeId" = 1',
      );
      expect(people.rows.map((r) => r.FirstName)).toEqual(['Restore']);
    } finally {
      await restored.close();
    }
  });

  it("dumpDatabase('auto') gzips the tar and still round-trips", async () => {
    const gz = await dumpDatabase('auto');
    // gzip magic bytes — proves the backup is actually compressed (the §7 size fix).
    const head = new Uint8Array(await gz.slice(0, 2).arrayBuffer());
    expect([head[0], head[1]]).toEqual([0x1f, 0x8b]);
    // …and loadDataDir transparently decompresses it, so restore still works.
    const restored = await PGlite.create({ loadDataDir: gz });
    try {
      const res = await restored.query<{ Name: string }>('SELECT "Name" FROM _probe ORDER BY "Id"');
      expect(res.rows.map((r) => r.Name)).toEqual(['Ada', 'Grace']);
    } finally {
      await restored.close();
    }
  });

  it("dumpDatabase('none') is an uncompressed tar (no gzip magic) — used for the rollback snapshot", async () => {
    const raw = await dumpDatabase('none');
    const head = new Uint8Array(await raw.slice(0, 2).arrayBuffer());
    expect([head[0], head[1]]).not.toEqual([0x1f, 0x8b]);
  });

  it('validateDump() accepts a real dump', async () => {
    const blob = await dumpDatabase();
    await expect(validateDump(blob)).resolves.toBeUndefined();
  });

  it('validateDump() REJECTS a corrupt/wrong file (so restore aborts before wiping data)', async () => {
    await expect(validateDump(new Blob(['this is not a pglite tarball']))).rejects.toBeTruthy();
    await expect(validateDump(new Blob([]))).rejects.toBeTruthy();
  });

  it('loadDataDir into an existing datadir throws — why restore must clear IndexedDB first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heirloom-restore-'));
    try {
      const a = await PGlite.create(dir);
      await a.exec('CREATE TABLE t (x int); INSERT INTO t VALUES (7);');
      const dump = await a.dumpDataDir('none');
      await a.close();
      // Second create over the SAME (now-populated) dir with loadDataDir must throw.
      await expect(PGlite.create(dir, { loadDataDir: dump })).rejects.toThrow(/already exists/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
