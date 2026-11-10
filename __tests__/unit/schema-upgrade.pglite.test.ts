import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { query, __setTestDb, inspectBackupLogical, validateDump } from '@/lib/db/connection.pglite';
import { SCHEMA_VERSION } from '@/lib/db/init-schema';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

/**
 * #811 item 5: a database from an older release upgrades in place without losing
 * a row, its migrated values come out right, and it ends with the same schema as
 * a fresh install.
 *
 * Every `test-fixtures/schema-v<N>.hlbak` is a real database written by an older
 * release's own code (`scripts/fixture-previous-release.sh <tag>` cuts a new one
 * from a release tag), so the migrations run against the shapes that release
 * left, not a re-run of the current schema. `synthetic.hlbak` is included too: it
 * is the fixture the manual upgrade checks restore.
 */

const FIXTURES = path.resolve(process.cwd(), 'test-fixtures');
const OLD_BACKUPS = [
  ...readdirSync(FIXTURES).filter((name) => /^schema-v\d+\.hlbak$/.test(name)).sort(),
  'synthetic.hlbak',
];

const TABLES_SQL = `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;

/** Columns, as a fresh install and an upgraded database must both have them. */
const COLUMNS_SQL = `SELECT table_name, column_name, data_type, is_nullable, column_default, generation_expression
  FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`;

/** Constraints by table and definition. Names are left out: an old release may have named one differently. */
const CONSTRAINTS_SQL = `SELECT conrelid::regclass::text AS tbl, contype, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2, 3`;

const INDEXES_SQL = `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`;

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

/** Boot `db` through the real lazy gate, which runs the upgrade. */
async function boot(db: PGlite): Promise<void> {
  __setTestDb(db);
  await query('SELECT 1');
  __setTestDb(null);
}

async function storedVersion(db: PGlite): Promise<number> {
  const v = await db.query<{ v: number }>('SELECT MAX("Version") AS v FROM "_SchemaMeta"');
  return v.rows[0].v;
}

async function rowCounts(db: PGlite): Promise<Record<string, number>> {
  const tables = (await db.query<{ tablename: string }>(TABLES_SQL)).rows.map((r) => r.tablename);
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const r = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "${table}"`);
    counts[table] = r.rows[0].n;
  }
  return counts;
}

async function columnType(db: PGlite, table: string, column: string): Promise<string | null> {
  const r = await db.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return r.rows[0]?.data_type ?? null;
}

/** Case and journal times as epoch seconds; `zoneless` reads them in the session zone, as #789 does. */
async function caseInstants(db: PGlite, zoneless: boolean): Promise<unknown[]> {
  const at = (col: string) => zoneless
    ? `EXTRACT(EPOCH FROM ${col} AT TIME ZONE current_setting('TimeZone'))::text`
    : `EXTRACT(EPOCH FROM ${col})::text`;
  const r = await db.query(`
    SELECT 'case' AS kind, "Id", ${at('"CreatedAt"')} AS created, ${at('"UpdatedAt"')} AS updated FROM "Cases"
    UNION ALL
    SELECT 'comment', "Id", ${at('"CreatedAt"')}, NULL FROM "CaseComments"
    ORDER BY 1, 2`);
  return r.rows;
}

/** The fold `SearchFold` applies, written independently in JS. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

async function schemaShape(db: PGlite) {
  return {
    columns: (await db.query(COLUMNS_SQL)).rows,
    constraints: (await db.query(CONSTRAINTS_SQL)).rows,
    indexes: (await db.query(INDEXES_SQL)).rows,
  };
}

describe('upgrading an older release database (#811)', () => {
  it('has a fixture from a schema older than the current one', () => {
    expect(OLD_BACKUPS.length).toBeGreaterThan(1);
  });

  it.each(OLD_BACKUPS)('%s keeps every row and ends with the fresh-install schema', async (file) => {
    // What Restore does with the file: rebuild and count it for the confirmation,
    // then check the rebuilt database before it replaces the live one.
    const { datadir, totals } = await inspectBackupLogical(new Blob([readFileSync(path.join(FIXTURES, file))]));
    await validateDump(datadir);
    const db = await track(PGlite.create({ loadDataDir: datadir }));

    const oldVersion = await storedVersion(db);
    // The newest release's fixture is cut right after its tag, before `main` has a
    // newer migration, so it may equal the current version until one lands.
    expect(oldVersion).toBeLessThanOrEqual(SCHEMA_VERSION);
    // #789: zone-less case times, read as the instant PGlite's session zone gives them.
    const caseTimesWereZoneless = (await columnType(db, 'CaseComments', 'CreatedAt')) === 'timestamp without time zone';
    if (caseTimesWereZoneless) {
      // The fixture may have no cases at all; give the conversion rows to convert,
      // written the way that release's NOW() default wrote them.
      await db.query(`INSERT INTO "Cases" ("UserId", "TreeId", "Title", "CreatedAt", "UpdatedAt")
        SELECT "OwnerId", "Id", 'Upgrade check', '2026-03-29 01:30:00', '2026-10-25 02:30:00' FROM "Trees" ORDER BY "Id" LIMIT 1`);
      await db.query(`INSERT INTO "CaseComments" ("CaseId", "UserId", "Body", "CreatedAt")
        SELECT "Id", "UserId", 'Upgrade check', '2026-07-01 12:00:00' FROM "Cases" ORDER BY "Id" DESC LIMIT 1`);
    }
    const caseTimesBefore = caseTimesWereZoneless ? await caseInstants(db, true) : null;
    expect(caseTimesBefore?.length ?? 1).toBeGreaterThan(0);

    const before = await rowCounts(db);
    expect(before.People).toBeGreaterThan(0);
    expect(Number(totals.people)).toBe(before.People);

    await boot(db);

    expect(await storedVersion(db)).toBe(SCHEMA_VERSION);

    // No table lost a row; tables the upgrade added may only be empty or backfilled.
    const after = await rowCounts(db);
    for (const [table, n] of Object.entries(before)) {
      if (table === '_SchemaMeta') continue;
      expect(after[table], `${file}: ${table}`).toBe(n);
    }

    // #792: every name has its folded search form, so "Etienne" would find "Étienne".
    const names = (await db.query<{ FirstName: string | null; LastName: string | null; SearchName: string | null }>(
      `SELECT "FirstName", "LastName", "SearchName" FROM "People"`,
    )).rows;
    for (const n of names) {
      expect(n.SearchName).toBe(fold(`${n.FirstName ?? ''} ${n.LastName ?? ''}`));
    }

    // #789: case times are now TIMESTAMPTZ and still the same instant.
    expect(await columnType(db, 'CaseComments', 'CreatedAt')).toBe('timestamp with time zone');
    if (caseTimesBefore) {
      expect(await caseInstants(db, false)).toEqual(caseTimesBefore);
    }

    // #1251 (v68): every existing journal entry stays unstruck.
    const struck = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "CaseComments" WHERE "StruckAt" IS NOT NULL OR "StruckBy" IS NOT NULL OR "StruckReason" IS NOT NULL`,
    );
    expect(struck.rows[0].n).toBe(0);

    // A second boot is a no-op: the stored version now matches.
    await boot(db);
    expect(await rowCounts(db)).toEqual(after);

    // The upgraded database has exactly the schema a fresh install builds.
    const fresh = await track(newEmptyClusterDb());
    await boot(fresh);
    expect(await schemaShape(db)).toEqual(await schemaShape(fresh));
  }, 120_000);
});
