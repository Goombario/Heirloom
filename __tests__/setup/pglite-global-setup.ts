import { buildEmptyClusterSnapshotIfMissing } from './pglite-snapshot';

/**
 * Global setup for the integration suite on PGlite (vitest.pglite.config.ts).
 * Each file boots its own empty database (`pglite-engine.ts`), where the two
 * seeded users always get Ids 1 and 2, so no test-user-ids file is written.
 */
export async function setup() {
  await buildEmptyClusterSnapshotIfMissing();
}
