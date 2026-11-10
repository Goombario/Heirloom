import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// A merge must not duplicate a citation of a fact's DATE or PLAC (#990): not
// when the same file is merged again, and not into a tree imported before
// Citation."Part" existed, which holds those citations as whole-fact ones.

const USER_ID = 990990;
const FILE = readFileSync(join(process.cwd(), 'test-fixtures/gedcom-hostile/genealogy/part-citations.ged'));
let db: PGlite;
let treeId: number;

const load = (mode: 'overwrite' | 'merge') =>
  importGedcomService({ file: new File([FILE], 'tree.ged'), mode, currentUserId: USER_ID });

async function citations() {
  const rows = await query(
    `SELECT "FactTable", "Part", "Page" FROM "Citation" WHERE "TreeId" = $1 ORDER BY "FactTable", "Part", "Page"`,
    [treeId],
  );
  return (rows.rows as Array<{ FactTable: string; Part: string | null; Page: string | null }>)
    .map((c) => `${c.FactTable}${c.Part ? `.${c.Part}` : ''}: ${c.Page}`);
}

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('SELECT 1');
  await query(
    'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)',
    [USER_ID, 'part-citations@test.local', 'part-citations'],
  );
  treeId = await resolveDefaultTree(USER_ID);
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

describe('merging part citations (#990)', () => {
  it('leaves the citations unchanged when the same file is merged again', async () => {
    await load('overwrite');
    const before = await citations();
    expect(before.filter((c) => c.includes('.'))).toHaveLength(6);
    await load('merge');
    expect(await citations()).toEqual(before);
  });

  it('adds no copy to a tree that holds them as whole-fact citations', async () => {
    await load('overwrite');
    await query('UPDATE "Citation" SET "Part" = NULL WHERE "TreeId" = $1', [treeId]);
    const before = await citations();
    await load('merge');
    expect(await citations()).toEqual(before);
  });
});
