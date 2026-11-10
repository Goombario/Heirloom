import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { query, __setTestDb, logicalToDatadir } from '@/lib/db/connection.pglite';
import { SCHEMA_VERSION } from '@/lib/db/init-schema';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

/**
 * An interrupted migration on the static and desktop engine (#868). PGlite runs
 * the whole init in one transaction and writes `_SchemaMeta` inside it, so an
 * error part-way rolls everything back, and a tab closed part-way leaves an
 * uncommitted transaction that recovery discards. Either way the next boot
 * starts the migration again from the version the database last committed.
 *
 * `schema-v39.hlbak` is a real previous-release database (v39: the synthetic
 * fixture as generator version 2 wrote it, frozen when `synthetic.hlbak` moved on
 * for #913), so the upgrade case runs real migrations against real rows, not a
 * re-run of a current schema.
 */

const OLD_BACKUP = path.resolve(process.cwd(), 'test-fixtures/schema-v39.hlbak');

/** Counts of rows a migration must never lose. */
const COUNTS_SQL = `SELECT
  (SELECT COUNT(*) FROM "People") AS people,
  (SELECT COUNT(*) FROM "Families") AS families,
  (SELECT COUNT(*) FROM "Media") AS media,
  (SELECT COUNT(*) FROM "Sources") AS sources`;

/** The schema as the catalog sees it, so a half-applied upgrade shows up. */
const CATALOG_SQL = `SELECT table_name, column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' ORDER BY table_name, column_name`;

interface Interrupted {
  /** The datadir as it stood when the statement was reached, transaction still open. */
  crashImage: Blob | null;
}

/**
 * Wrap `db` so its `n`th query fails instead of running. With `crash`, the
 * datadir is dumped first, which is what a tab closed at that moment leaves.
 */
function failAt(db: PGlite, n: number, crash: boolean, out: Interrupted): PGlite {
  let calls = 0;
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'query') {
        return async (text: string, params?: unknown[]) => {
          calls += 1;
          if (calls === n) {
            if (crash) out.crashImage = await target.dumpDataDir('none');
            throw new Error(`interrupted at statement ${n}`);
          }
          return target.query(text, params);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** How many queries a full boot of this database issues, gate reads included. */
async function countBootQueries(load: () => Promise<PGlite>): Promise<number> {
  const db = await load();
  let calls = 0;
  __setTestDb(new Proxy(db, {
    get(target, prop) {
      if (prop === 'query') return (text: string, params?: unknown[]) => { calls += 1; return target.query(text, params); };
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }));
  await query('SELECT 1');
  __setTestDb(null);
  await db.close();
  return calls - 1; // the SELECT 1 itself
}

async function storedVersion(db: PGlite): Promise<number | null> {
  const reg = await db.query<{ ok: boolean }>(`SELECT to_regclass('"_SchemaMeta"') IS NOT NULL AS ok`);
  if (!reg.rows[0].ok) return null;
  const v = await db.query<{ v: number | null }>('SELECT MAX("Version") AS v FROM "_SchemaMeta"');
  return v.rows[0].v;
}

/** Interrupt points across the boot: early DDL, the middle, the version write, COMMIT. */
function interruptPoints(total: number): number[] {
  return [...new Set([4, Math.floor(total / 3), Math.floor((2 * total) / 3), total - 2, total])];
}

const open: PGlite[] = [];
async function track(db: PGlite | Promise<PGlite>): Promise<PGlite> {
  const resolved = await db;
  open.push(resolved);
  return resolved;
}

afterEach(async () => {
  __setTestDb(null);
  while (open.length) await open.pop()!.close().catch(() => {});
});

describe('an interrupted migration on PGlite', () => {
  it('leaves a fresh database empty and lets the next boot install the schema', async () => {
    const total = await countBootQueries(() => newEmptyClusterDb());

    for (const n of interruptPoints(total)) {
      const db = await track(newEmptyClusterDb());
      const out: Interrupted = { crashImage: null };
      __setTestDb(failAt(db, n, true, out));
      await expect(query('SELECT 1'), `statement ${n}`).rejects.toThrow(`interrupted at statement ${n}`);

      // An error part-way: the transaction rolled back, so nothing was created.
      const tables = await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`,
      );
      expect(tables.rows[0].n, `statement ${n}`).toBe(0);

      // A tab closed part-way: the next boot finishes the install.
      const reopened = await track(PGlite.create({ loadDataDir: out.crashImage! }));
      expect(await storedVersion(reopened), `statement ${n}`).toBeNull();
      __setTestDb(reopened);
      await query('SELECT 1');
      expect(await storedVersion(reopened)).toBe(SCHEMA_VERSION);
    }
  }, 120_000);

  it('keeps an older database at its version, with its rows, until an upgrade commits', async () => {
    const datadir = await logicalToDatadir(new Blob([readFileSync(OLD_BACKUP)]));
    const load = () => PGlite.create({ loadDataDir: datadir });

    const baseline = await track(load());
    const oldVersion = await storedVersion(baseline);
    expect(oldVersion).not.toBeNull();
    expect(oldVersion!).toBeLessThan(SCHEMA_VERSION);
    const before = (await baseline.query(COUNTS_SQL)).rows[0];
    const oldCatalog = (await baseline.query(CATALOG_SQL)).rows;
    expect(Number((before as { people: number }).people)).toBeGreaterThan(0);

    const total = await countBootQueries(load);
    for (const n of interruptPoints(total)) {
      const db = await track(load());
      const out: Interrupted = { crashImage: null };
      __setTestDb(failAt(db, n, true, out));
      await expect(query('SELECT 1'), `statement ${n}`).rejects.toThrow(`interrupted at statement ${n}`);
      expect(await storedVersion(db), `statement ${n}`).toBe(oldVersion);
      expect((await db.query(COUNTS_SQL)).rows[0], `statement ${n}`).toEqual(before);
      expect((await db.query(CATALOG_SQL)).rows, `statement ${n}`).toEqual(oldCatalog);

      const reopened = await track(PGlite.create({ loadDataDir: out.crashImage! }));
      expect(await storedVersion(reopened), `statement ${n}`).toBe(oldVersion);
      expect((await reopened.query(CATALOG_SQL)).rows, `statement ${n}`).toEqual(oldCatalog);
      __setTestDb(reopened);
      await query('SELECT 1');
      expect(await storedVersion(reopened), `statement ${n}`).toBe(SCHEMA_VERSION);
      expect((await reopened.query(COUNTS_SQL)).rows[0], `statement ${n}`).toEqual(before);
    }
  }, 180_000);
});
