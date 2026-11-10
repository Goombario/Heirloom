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
import { getLikelyDuplicates } from '@/lib/db/queries/data-quality';
import type { LikelyDuplicates } from '@/lib/likely-duplicates';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * #822 on the task audit's large tree (`npm run fixture:large-gedcom`, seed
 * 782): 40 planted duplicates, each with a NOTE naming the person it copies.
 * Before #822 the check flagged 731 people and found 33 of the 40. If a change
 * moves these numbers, decide whether it's better before updating them.
 */
const USER_ID = 987_822;

describe('likely duplicates on the large fixture', () => {
  let db: PGlite;
  let dir: string;
  let result: LikelyDuplicates;
  let planted: Set<string>;
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'likely-duplicates-'));
    const out = path.join(dir, 'large-tree.ged');
    execFileSync(process.execPath, [path.resolve('scripts/ux-audit/gen-large-gedcom.mjs'), '--out', out]);

    // Planted pairs, from the generator's NOTE on each copy.
    const xrefs: [string, string][] = [];
    let current = '';
    for (const line of readFileSync(out, 'utf8').split(/\r?\n/)) {
      const indi = line.match(/^0 (@I\d+@) INDI/);
      if (indi) current = indi[1];
      const note = line.match(/^1 NOTE Possibly the same person as (@I\d+@)/);
      if (note) xrefs.push([note[1], current]);
    }

    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
    await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'dupes@test.local', 'dupes']);
    const treeId = await resolveDefaultTree(USER_ID);
    const file = new File([readFileSync(out)], 'large-tree.ged', { type: 'text/plain' });
    expect((await importGedcomService({ file, mode: 'overwrite', currentUserId: USER_ID })).peopleCount).toBe(4834);

    const ids = new Map(((await query('SELECT "Id", "GedcomId" FROM "People" WHERE "TreeId" = $1', [treeId])).rows as { Id: number; GedcomId: string }[])
      .map((r) => [r.GedcomId, r.Id]));
    planted = new Set(xrefs.map(([a, b]) => key(ids.get(a)!, ids.get(b)!)));
    result = await getLikelyDuplicates(treeId);
  }, 180_000);

  afterAll(async () => {
    __setTestDb(null);
    await db?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('finds every planted duplicate (recall)', () => {
    expect(planted.size).toBe(40);
    const found = result.pairs.filter(([a, b]) => planted.has(key(a, b)));
    expect(found).toHaveLength(40);
  });

  it('counts close to the 40 planted (precision)', () => {
    // The other 33 are distinct people with the same name, born within two
    // years, where the family rules allow a match (one side has no parents on
    // record, or they share them). Before #822: 731 people flagged.
    expect(result.pairs).toHaveLength(73);
    expect(40 / result.pairs.length).toBeGreaterThan(0.5);
    expect(result.groups.flat()).toHaveLength(new Set(result.groups.flat()).size);
  });
});
