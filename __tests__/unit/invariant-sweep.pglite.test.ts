import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { deletePersonService } from '@/lib/services/people';
import { deleteFamilyService } from '@/lib/services/families';
import { removeSourceService } from '@/lib/services/sources';
import { deleteTreeService } from '@/lib/services/trees';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { runInvariantSweep, sweepExitCode, type SweepReport } from '@/scripts/audit/invariant-sweep';
import { seedRoundTripFixture, type FixtureIds } from '../setup/gedcom-roundtrip-fixture';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

const USER_ID = 864864;
const exec = { query: (text: string, params?: unknown[]) => query(text, params) };
const sweep = () => runInvariantSweep(exec);
const checksOf = (findings: SweepReport['violations']) => findings.map((f) => f.check);

describe('invariant sweep (#864)', () => {
  let db: PGlite;
  let dir: string;
  let large: File;
  let treeId: number;
  let fixture: FixtureIds;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sweep-'));
    const out = path.join(dir, 'large-tree.ged');
    execFileSync(process.execPath, [path.resolve('scripts/ux-audit/gen-large-gedcom.mjs'), '--out', out]);
    large = new File([readFileSync(out)], 'large-tree.ged', { type: 'text/plain' });
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
    await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'sweep@test.local', 'sweep']);
    treeId = await resolveDefaultTree(USER_ID);
    fixture = await seedRoundTripFixture(db);
  }, 60_000);

  afterAll(async () => {
    __setTestDb(null);
    await db?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('is clean after an overwrite import, a merge import, and on the round-trip fixture', async () => {
    await importGedcomService({ file: large, mode: 'overwrite', currentUserId: USER_ID });
    expect(await sweep()).toEqual({ violations: [], strands: [] });
    await importGedcomService({ file: large, mode: 'merge', currentUserId: USER_ID });
    expect(await sweep()).toEqual({ violations: [], strands: [] });
  }, 300_000);

  it('reports deliberate strands after deleting a person, a family and a source, but no violations', async () => {
    const scope = { requestedTreeId: treeId, requestedOwnerId: null, currentUserId: USER_ID };
    const person = (await query(
      `SELECT p."Id" FROM "People" p WHERE p."TreeId" = $1
         AND EXISTS (SELECT 1 FROM "Events" e WHERE e."PersonId" = p."Id")
         AND EXISTS (SELECT 1 FROM "Families" f WHERE p."Id" IN (f."Partner1Id", f."Partner2Id"))
       ORDER BY p."Id" LIMIT 1`, [treeId],
    )).rows[0] as { Id: number };
    const family = (await query(
      `SELECT f."Id" FROM "Families" f WHERE f."TreeId" = $1
         AND EXISTS (SELECT 1 FROM "FamilyPerson" fp WHERE fp."FamiliesAsChildId" = f."Id")
         AND $2 NOT IN (COALESCE(f."Partner1Id", 0), COALESCE(f."Partner2Id", 0))
       ORDER BY f."Id" LIMIT 1`, [treeId, person.Id],
    )).rows[0] as { Id: number };
    const source = (await query(`SELECT "Id" FROM "Sources" WHERE "TreeId" = $1 ORDER BY "Id" LIMIT 1`, [treeId])).rows[0] as { Id: number };

    await deletePersonService({ ...scope, id: person.Id });
    await deleteFamilyService({ ...scope, id: family.Id });
    await removeSourceService({ ...scope, id: source.Id });

    const report = await sweep();
    expect(report.violations).toEqual([]);
    expect(sweepExitCode(report)).toBe(0);
    expect(checksOf(report.strands)).toEqual(expect.arrayContaining(['event_person_missing', 'child_link_family_missing']));
  }, 120_000);

  it('is clean after deleting a whole tree', async () => {
    const extra = (await query(
      `INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Extra') RETURNING "Id"`, [fixture.userId],
    )).rows[0] as { Id: number };
    await deleteTreeService({ id: fixture.treeId, currentUserId: fixture.userId });
    const report = await sweep();
    expect(report.violations).toEqual([]);
    expect((await query('SELECT COUNT(*)::int AS n FROM "People" WHERE "TreeId" = $1', [fixture.treeId])).rows[0]).toEqual({ n: 0 });
    expect(extra.Id).toBeGreaterThan(0);
  }, 120_000);

  it('finds planted violations and exits non-zero', async () => {
    const other = (await query(
      `INSERT INTO "Trees" ("OwnerId", "Name") VALUES ($1, 'Other') RETURNING "Id"`, [USER_ID],
    )).rows[0] as { Id: number };
    const person = (await query(`SELECT "Id" FROM "People" WHERE "TreeId" = $1 ORDER BY "Id" LIMIT 1`, [treeId])).rows[0] as { Id: number };
    await query(`INSERT INTO "Events" ("UserId", "TreeId", "Type", "PersonId") VALUES ($1, $2, 'OCCU', $3)`, [USER_ID, other.Id, person.Id]);
    await query(`INSERT INTO "NameVariant" ("OwnerId", "TreeId", "PersonId", "Type", "Name") VALUES ($1, $2, $3, 'Alias', 'Dup'), ($1, $2, $3, 'Alias', 'Dup')`, [USER_ID, treeId, person.Id]);
    await query(`INSERT INTO "Events" ("UserId", "TreeId", "Type", "PersonId") VALUES ($1, $2, 'OCCU', 99999999)`, [USER_ID, treeId]);
    await query(`INSERT INTO "Places" ("UserId", "TreeId", "Name") VALUES ($1, $2, 'Drift')`, [fixture.userId, treeId]);

    const report = await sweep();
    expect(checksOf(report.violations)).toEqual(expect.arrayContaining([
      'cross_tree_event_person', 'duplicate_name_variant', 'event_person_missing', 'owner_tree_drift_Places',
    ]));
    expect(sweepExitCode(report)).toBe(1);
  });
});
