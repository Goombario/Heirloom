import { PGlite } from '@electric-sql/pglite';
import { ensureSchema } from './ensure-schema';

/**
 * The static build's starting database: an empty data directory with the
 * schema applied and the `_SchemaMeta` version recorded, as a gzipped tarball.
 *
 * On a first visit the worker loads this with `loadDataDir` (lib/db/pglite-worker.ts)
 * instead of running initdb and the ~80-statement schema init in the browser,
 * which cost seconds before the first page could read anything. Built at build
 * time by scripts/build-pglite-seed.ts with the PGlite version the app ships.
 *
 * Holds no user data. The app creates the local user and tree on first use.
 */
export async function buildPgliteSeed(): Promise<Blob> {
  const db = await PGlite.create();
  try {
    await ensureSchema(db);
    // No VACUUM or ANALYZE: either records the empty tables as known-empty
    // (reltuples 0, not -1), and the planner then keeps choosing plans for empty
    // tables during the first import. Measured: a 4,800-person import went from
    // 14s to 51s.
    await db.exec('CHECKPOINT');
    return await db.dumpDataDir('gzip');
  } finally {
    await db.close();
  }
}
