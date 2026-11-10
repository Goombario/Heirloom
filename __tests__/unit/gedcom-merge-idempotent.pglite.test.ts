import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { seedRoundTripFixture, type FixtureIds } from '../setup/gedcom-roundtrip-fixture';
import { readBundle, stageFixtureMedia, type Bundle } from '../setup/gedcom-bundle';
import { canonicalizeTree, type CanonicalTree } from '../setup/gedcom-canonical';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * The idempotency assertion #492 names: import the same bundle twice into a tree
 * that already contains its records, and require every non-media canonical
 * projection to be unchanged by the second pass. Media cross-import identity is
 * explicitly deferred to #629; PR B's boundary is document-local media identity.
 *
 * Broader than any per-channel count. `canonicalizeTree` compares every modelled
 * channel at once with natural keys substituted for surrogate ids, so a second
 * merge that forks a row, drops a link, or re-points a foreign key anywhere fails
 * here even where no targeted assertion covers that channel yet. That is the
 * point: #492's finding (3) was a whole channel nobody had an assertion for.
 *
 * Lives in `unit/` rather than `integration/` because `canonicalizeTree` reads
 * through `lib/db/connection.pglite` — against real Postgres it throws
 * "Worker is not defined".
 *
 * Note the comparison is merge-1 vs merge-2, not seed vs merge-1. The first merge
 * legitimately changes the tree (it is the pass that re-attaches anything the
 * export/import cycle re-created); idempotency is the claim that every merge
 * AFTER that one is a no-op.
 */
describe('a repeated merge import of the same bundle is a no-op (#492)', () => {
  let mdb: PGlite;
  let ids: FixtureIds;
  let afterFirstMerge: CanonicalTree;
  let afterSecondMerge: CanonicalTree;
  let restoreDataDir: () => void;

  beforeAll(async () => {
    mdb = await newEmptyClusterDb();
    __setTestDb(mdb);
    await query('SELECT 1');
    ids = await seedRoundTripFixture(mdb);
    restoreDataDir = await stageFixtureMedia(mdb, ids);

    const { exportGedcomService } = await import('@/lib/services/gedcom-export');
    const { importGedcomService } = await import('@/lib/services/gedcom');

    const result = await exportGedcomService({
      requestedTreeId: ids.treeId,
      requestedOwnerId: null,
      currentUserId: ids.userId,
      includeMedia: true,
    });
    if (result.kind !== 'zip') throw new Error('expected a zip bundle');
    const bundle: Bundle = await readBundle(result.buffer);

    // Exactly what the browser importer sends: the .ged as a File plus each
    // sidecar as a JSON string (the route unzips client-side).
    const mergeOnce = () => importGedcomService({
      file: new File([bundle.ged], 'family_tree.ged', { type: 'text/plain' }),
      mode: 'merge',
      casesJson: JSON.stringify(bundle.cases),
      mediaJson: JSON.stringify(bundle.media),
      sourcesJson: JSON.stringify(bundle.sources),
      placesJson: JSON.stringify(bundle.places),
      currentUserId: ids.userId,
      requestedTreeId: ids.treeId,
    });

    await mergeOnce();
    afterFirstMerge = await canonicalizeTree(ids.treeId);
    await mergeOnce();
    afterSecondMerge = await canonicalizeTree(ids.treeId);
  }, 180_000);

  afterAll(async () => {
    restoreDataDir?.();
    __setTestDb(null);
    await mdb.close();
  });

  // Per-channel rather than one whole-object toEqual, so a failure names the
  // channel that forked instead of dumping the entire tree.
  const channels: Array<keyof CanonicalTree> = [
    'people', 'families', 'events', 'sources', 'repositories',
    'citations', 'notes', 'nameVariants', 'places',
  ];

  for (const channel of channels) {
    it(`does not change ${channel} on the second merge`, () => {
      expect(afterSecondMerge[channel]).toEqual(afterFirstMerge[channel]);
    });
  }
});
