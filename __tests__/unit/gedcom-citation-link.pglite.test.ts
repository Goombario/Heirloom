import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { exportGedcomService } from '@/lib/services/gedcom-export';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { initializeSchema } from '@/lib/db/init-schema';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// A citation's record link (#1024, ADR 0025): `_LINK`, `_URL` and `WWW` under a
// citation become Citation."Url", export writes it once as `_LINK`, and the boot
// that adds the column lifts links already kept as passthrough.

const USER_ID = 1024;
const LONG = `https://records.example.org/${'x'.repeat(260)}`;
const GED = [
  '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
  '0 @S1@ SOUR', '1 TITL Fictional register',
  '0 @I1@ INDI', '1 NAME Ada /Example/',
  '2 SOUR @S1@', '3 PAGE name entry', '3 WWW https://records.example.org/name@@1',
  '1 BIRT', '2 DATE 1 JAN 1900',
  '2 SOUR @S1@', '3 PAGE p. 1', '3 _LINK https://records.example.org/birth/1', '3 _LINK https://records.example.org/birth/2',
  '1 DEAT', '2 DATE 1 JAN 1970',
  '2 SOUR @S1@', '3 PAGE p. 9', `3 _URL ${LONG.slice(0, 200)}`, `4 CONC ${LONG.slice(200)}`,
  '0 TRLR',
].join('\n');

let db: PGlite;
let treeId: number;

async function rows() {
  const res = await query(
    `SELECT "FactTable", "Url", "RawGedcom" FROM "Citation" WHERE "TreeId" = $1 ORDER BY "FactTable"`,
    [treeId],
  );
  return res.rows as Array<{ FactTable: string; Url: string | null; RawGedcom: string | null }>;
}

async function exported() {
  const out = await exportGedcomService({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID, includeMedia: false });
  if (out.kind !== 'ged') throw new Error(`expected a .ged, got ${out.kind}`);
  return out.content.split(/\r?\n/);
}

const load = (text: string, mode: 'overwrite' | 'merge' = 'overwrite') =>
  importGedcomService({ file: new File([text], 'tree.ged'), mode, currentUserId: USER_ID });

const EXPECTED = [
  { FactTable: 'PersonBirth', Url: 'https://records.example.org/birth/1', RawGedcom: '1 _LINK https://records.example.org/birth/2' },
  { FactTable: 'PersonDeath', Url: LONG, RawGedcom: null },
  { FactTable: 'PersonName', Url: 'https://records.example.org/name@1', RawGedcom: null },
];

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('SELECT 1');
  await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'link@test.local', 'citation-link']);
  treeId = await resolveDefaultTree(USER_ID);
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

describe('a citation record link in GEDCOM (#1024)', () => {
  it('imports the first link under each citation into Url', async () => {
    await load(GED);
    expect(await rows()).toEqual(EXPECTED);
  });

  it('exports each link once as _LINK and re-imports the same state', async () => {
    await load(GED);
    const lines = await exported();
    const links = lines.filter((l) => /^\d+ _LINK /.test(l));
    expect(links).toEqual([
      '3 _LINK https://records.example.org/name@1',
      '3 _LINK https://records.example.org/birth/1',
      '3 _LINK https://records.example.org/birth/2',
      expect.stringMatching(/^3 _LINK https:\/\/records\.example\.org\/x+$/),
    ]);
    expect(lines.some((l) => /^\d+ (WWW|_URL) /.test(l))).toBe(false);
    expect(lines.some((l) => /^\d+ PAGE .*https?:/.test(l))).toBe(false);

    await load(lines.join('\n'));
    expect(await rows()).toEqual(EXPECTED);
  });

  it('adds no duplicate when the same file is merged again', async () => {
    await load(GED);
    await load(GED, 'merge');
    expect(await rows()).toEqual(EXPECTED);
  });

  it('lifts links kept as passthrough until the backfill has finished once', async () => {
    await load(GED);
    await query(`UPDATE "Citation" SET "RawGedcom" = $2 WHERE "TreeId" = $1 AND "FactTable" = 'PersonBirth'`,
      [treeId, '1 _LINK https://records.example.org/birth/1\n1 _LINK https://records.example.org/birth/2']);
    await query(`ALTER TABLE "Citation" DROP COLUMN "Url"`);
    await query(`UPDATE "Citation" SET "RawGedcom" = '1 WWW https://records.example.org/name@@1' WHERE "TreeId" = $1 AND "FactTable" = 'PersonName'`, [treeId]);

    await initializeSchema({ query: (sql: string, params?: unknown[]) => query(sql, params) });
    const lifted = await rows();
    expect(lifted.find((r) => r.FactTable === 'PersonBirth')).toEqual(EXPECTED[0]);
    expect(lifted.find((r) => r.FactTable === 'PersonName')).toEqual(EXPECTED[2]);

    // Clearing the link later doesn't bring back the second one on the next boot.
    await query(`UPDATE "Citation" SET "Url" = NULL WHERE "TreeId" = $1 AND "FactTable" = 'PersonBirth'`, [treeId]);
    await initializeSchema({ query: (sql: string, params?: unknown[]) => query(sql, params) });
    expect((await rows()).find((r) => r.FactTable === 'PersonBirth')?.Url).toBeNull();

    // A backfill that failed partway (no completion comment) runs again and
    // lifts what it hadn't reached; the citation it had already done stays cleared.
    await query(`COMMENT ON COLUMN "Citation"."Url" IS NULL`);
    await query(`UPDATE "Citation" SET "Url" = NULL, "RawGedcom" = '1 _LINK https://records.example.org/death/1' WHERE "TreeId" = $1 AND "FactTable" = 'PersonDeath'`, [treeId]);
    await query(`UPDATE "Citation" SET "RawGedcom" = NULL WHERE "TreeId" = $1 AND "FactTable" = 'PersonBirth'`, [treeId]);
    await initializeSchema({ query: (sql: string, params?: unknown[]) => query(sql, params) });
    const resumed = await rows();
    expect(resumed.find((r) => r.FactTable === 'PersonDeath')).toMatchObject({ Url: 'https://records.example.org/death/1', RawGedcom: null });
    expect(resumed.find((r) => r.FactTable === 'PersonBirth')?.Url).toBeNull();
  });
});
