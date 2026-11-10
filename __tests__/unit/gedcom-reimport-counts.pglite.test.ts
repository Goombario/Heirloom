import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { getTreeCountsService } from '@/lib/services/tree-counts';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { seedRoundTripFixture, type FixtureIds } from '../setup/gedcom-roundtrip-fixture';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

const USER_ID = 863863;

/** Rows each import appends by design: its audit summary. */
const APPEND_ONLY = new Set(['AuditLog']);

/**
 * Tables overwrite clears that getTreeCountsService doesn't count, each with the
 * counted parent it can't exist without, so "every count is 0" still means
 * "nothing to lose" (ADR 0008). A new tree-scoped table that overwrite clears
 * fails the test below until it is counted or listed here with its parent.
 */
const DEPENDENT_OF_COUNTED: Record<string, string> = {
  NameVariant: 'People',
  MediaFaceCandidate: 'Media',
  MediaImportItem: 'Media',
};

/** The table behind each count getTreeCountsService returns (pinned to its source by tree-counts-lockstep). */
const COUNTED: Record<string, string> = {
  people: 'People', families: 'Families', events: 'Events', media: 'Media', cases: 'Cases',
  places: 'Places', sources: 'Sources', repositories: 'Repository', notes: 'Note', citations: 'Citation',
  dataCheckConfirmations: 'DataCheckConfirmations',
};

async function tableCounts(where = ''): Promise<Record<string, number>> {
  const tables = (await query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_SchemaMeta' ORDER BY 1`,
  )).rows as Array<{ tablename: string }>;
  const out: Record<string, number> = {};
  for (const { tablename } of tables) {
    out[tablename] = ((await query(`SELECT COUNT(*)::int AS n FROM "${tablename}" ${where}`)).rows[0] as { n: number }).n;
  }
  return out;
}

async function treeScopedTables(): Promise<string[]> {
  return ((await query(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'TreeId' ORDER BY 1`,
  )).rows as Array<{ table_name: string }>).map((r) => r.table_name);
}

const TINY = new File(['0 HEAD\n0 @I1@ INDI\n1 NAME Only /One/\n0 TRLR'], 'tiny.ged', { type: 'text/plain' });

async function perTreeCounts(treeId: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of await treeScopedTables()) {
    out[table] = ((await query(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE "TreeId" = $1`, [treeId])).rows[0] as { n: number }).n;
  }
  return out;
}

describe('re-importing the same file changes nothing (#863)', () => {
  let db: PGlite;
  let dir: string;
  let large: File;
  let treeId: number;
  let fixture: FixtureIds;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'reimport-'));
    const out = path.join(dir, 'large-tree.ged');
    execFileSync(process.execPath, [path.resolve('scripts/ux-audit/gen-large-gedcom.mjs'), '--out', out]);
    large = new File([readFileSync(out)], 'large-tree.ged', { type: 'text/plain' });
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
    await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'reimport@test.local', 'reimport']);
    treeId = await resolveDefaultTree(USER_ID);
    await importGedcomService({ file: large, mode: 'overwrite', currentUserId: USER_ID });
    // A second, richer tree (media, face tags, cases, repositories) for the gate check.
    fixture = await seedRoundTripFixture(db);
  }, 120_000);

  afterAll(async () => {
    __setTestDb(null);
    await db?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('merging the large fixture into itself twice leaves every table unchanged', async () => {
    const before = await tableCounts();
    expect((await perTreeCounts(treeId)).People).toBe(4834);
    for (let pass = 1; pass <= 2; pass++) {
      await importGedcomService({ file: large, mode: 'merge', currentUserId: USER_ID });
      const after = await tableCounts();
      for (const table of APPEND_ONLY) {
        expect(after[table], table).toBe(before[table] + pass);
        delete after[table];
      }
      expect(after).toEqual(Object.fromEntries(Object.entries(before).filter(([t]) => !APPEND_ONLY.has(t))));
    }
  }, 300_000);

  it('overwrite clears only counted tables (or their dependents), and only in the target tree', async () => {
    const otherBefore = await perTreeCounts(treeId);
    const targetBefore = await perTreeCounts(fixture.treeId);
    const counts = await getTreeCountsService({
      requestedTreeId: fixture.treeId, requestedOwnerId: null, currentUserId: fixture.userId,
    });

    await importGedcomService({ file: TINY, mode: 'overwrite', currentUserId: fixture.userId, requestedTreeId: fixture.treeId });

    expect(await perTreeCounts(treeId)).toEqual(otherBefore);
    const targetAfter = await perTreeCounts(fixture.treeId);
    const cleared = Object.keys(targetBefore).filter((t) => targetAfter[t] < targetBefore[t]);
    expect(cleared).toEqual(expect.arrayContaining(['People', 'Media', 'Cases', 'Repository', 'Citation']));
    const counted = new Set(Object.values(COUNTED));
    const unaccounted = cleared.filter((t) => !counted.has(t) && !(t in DEPENDENT_OF_COUNTED));
    expect(unaccounted, 'cleared by overwrite but neither counted nor a declared dependent').toEqual([]);
    // Every cleared counted table was non-zero in the gate's counts, so the user was asked.
    for (const [key, table] of Object.entries(COUNTED)) {
      if (cleared.includes(table)) expect((counts as unknown as Record<string, number>)[key], key).toBeGreaterThan(0);
    }
  }, 120_000);
});
