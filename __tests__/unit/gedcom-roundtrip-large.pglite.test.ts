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
import { roundTrip } from '../setup/gedcom-bundle';
import { canonicalizeTree, type CanonicalTree } from '../setup/gedcom-canonical';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

// #866: the large generated fixture (remarriages, planted duplicates, a planted
// case per data check) through export → import → field-level comparison, per
// table. gedcom-roundtrip-semantic.pglite.test.ts does the same for the small
// hand-built fixture that seeds every channel; this one adds volume and the
// shapes the generator plants.

const USER_ID = 866866;

describe('the large fixture is field-for-field unchanged by an export → import round trip (#866)', () => {
  let db: PGlite;
  let before: CanonicalTree;
  let after: CanonicalTree;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
    await query(
      'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)',
      [USER_ID, 'roundtrip-large@test.local', 'roundtrip-large'],
    );
    const treeId = await resolveDefaultTree(USER_ID);
    const dir = mkdtempSync(path.join(tmpdir(), 'roundtrip-large-'));
    try {
      const out = path.join(dir, 'large-tree.ged');
      execFileSync(process.execPath, [path.resolve('scripts/ux-audit/gen-large-gedcom.mjs'), '--out', out]);
      const file = new File([readFileSync(out)], 'large-tree.ged', { type: 'text/plain' });
      await importGedcomService({ file, mode: 'overwrite', currentUserId: USER_ID });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    before = await canonicalizeTree(treeId);
    await roundTrip({ userId: USER_ID, treeId, personIds: {}, familyIds: {}, caseIds: {}, sourceId: 0, mediaIds: {} });
    after = await canonicalizeTree(treeId);
  }, 300_000);

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  it('carries data in the main tables', () => {
    for (const table of ['people', 'families', 'events', 'sources', 'citations', 'notes', 'places'] as const) {
      expect(before[table].length, table).toBeGreaterThan(0);
    }
  });

  // No deliberate losses: every projected table must match exactly.
  for (const table of [
    'people', 'families', 'events', 'sources', 'repositories', 'citations', 'notes',
    'nameVariants', 'media', 'mediaLinks', 'mediaTags', 'places', 'cases',
  ] as const) {
    it(`preserves ${table}`, () => expect(after[table]).toEqual(before[table]));
  }
});
