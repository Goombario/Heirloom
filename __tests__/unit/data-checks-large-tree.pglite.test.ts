import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { getDataCheckInput } from '@/lib/db/queries/data-checks';
import { runDataChecks } from '@/lib/data-checks/engine';
import type { DataCheckInput } from '@/lib/data-checks/rules';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * #828 on the task audit's large tree (`npm run fixture:large-gedcom`, seed 782:
 * 4,824 people, plus 10 planted for the unlikely rules). The checks run over
 * the whole tree on every page load, so the engine has a budget of 300 ms. If
 * this fails, make the module faster; don't store results (#786).
 *
 * The audit's "Mary Ellen Byrne" (ED-6) is @I2245@ here: born 17 Jun 1813,
 * died 27 Jan 1814, and the mother of four children born 1843–1849.
 */
const USER_ID = 987_828;
const BUDGET_MS = 300;

describe('data checks on the large fixture', () => {
  let db: PGlite;
  let dir: string;
  let treeId: number;
  let input: DataCheckInput;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'data-checks-'));
    const out = path.join(dir, 'large-tree.ged');
    execFileSync(process.execPath, [path.resolve('scripts/ux-audit/gen-large-gedcom.mjs'), '--out', out]);

    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
    await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'checks@test.local', 'checks']);
    treeId = await resolveDefaultTree(USER_ID);
    const file = new File([readFileSync(out)], 'large-tree.ged', { type: 'text/plain' });
    const result = await importGedcomService({ file, mode: 'overwrite', currentUserId: USER_ID });
    expect(result.peopleCount).toBe(4834);
    input = await getDataCheckInput(treeId);
  }, 180_000);

  afterAll(async () => {
    __setTestDb(null);
    await db?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it(`runs in under ${BUDGET_MS} ms`, () => {
    runDataChecks(input); // warm up
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      runDataChecks(input);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(BUDGET_MS);
  });

  it('flags "Mary Ellen" once under a mother’s death, with her four children', async () => {
    const id = async (gedcomId: string) => ((await query('SELECT "Id" FROM "People" WHERE "TreeId" = $1 AND "GedcomId" = $2', [treeId, gedcomId])).rows[0] as { Id: number }).Id;
    const mary = await id('@I2245@');
    const problems = runDataChecks(input);
    const hers = problems.filter((p) => p.rule === 'child_born_after_mother_death' && p.personId === mary);
    expect(hers).toHaveLength(1);
    expect(hers[0].relatedPersonIds).toHaveLength(4);
    expect(hers[0].editable).toEqual([`PersonDeath:${mary}`]);
    // Her children are never entries of their own under that rule.
    const kids = new Set(hers[0].relatedPersonIds);
    expect(problems.some((p) => p.rule === 'child_born_after_mother_death' && kids.has(p.personId))).toBe(false);
    // One bad death date gives two entries, not a third "died young" (#841).
    expect(problems.filter((p) => p.personId === mary).map((p) => p.rule))
      .toEqual(['child_born_after_mother_death', 'partnership_after_death']);
  });

  it('has one planted problem per unlikely rule, so the tree can exercise Confirm', async () => {
    const byId = new Map(((await query('SELECT "Id", "GedcomId" FROM "People" WHERE "TreeId" = $1', [treeId])).rows as { Id: number; GedcomId: string }[])
      .map((r) => [r.Id, r.GedcomId]));
    const planted = runDataChecks(input)
      .filter((p) => Number(byId.get(p.personId)?.match(/\d+/)?.[0]) > 4824)
      .map((p) => [p.rule, byId.get(p.personId)]);
    expect(planted).toEqual([
      ['parent_too_young', '@I4830@'],
      ['mother_too_old', '@I4828@'],
      ['married_too_young', '@I4834@'],
      ['died_too_old', '@I4825@'],
      ['living_too_old', '@I4826@'],
    ]);
  });
});
