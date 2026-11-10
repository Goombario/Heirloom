import { PGlite } from '@electric-sql/pglite';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import path from 'path';

/**
 * Fast PGlite boot for tests via an "empty-cluster" datadir snapshot.
 *
 * Every `new PGlite()` runs Postgres `initdb` — a fresh cluster bootstrap that
 * costs ~700ms-1s per instance (measured; it dwarfs both the WASM compile and
 * our ~80-statement schema init, which is only ~130ms). Because vitest isolates
 * each test file in its own fork, ~24 unit files each pay that `initdb` toll.
 *
 * Fix: `initdb` ONCE (in globalSetup), `dumpDataDir()` the empty-but-initialized
 * cluster to a cached file, and have each file `PGlite.create({ loadDataDir })`
 * it instead. Loading a pre-initialized cluster skips `initdb` (~700ms/file).
 *
 * Crucially the snapshot has NO schema — it is a bare initdb'd cluster — so every
 * test still runs its OWN `initializeSchema` (via the connection.pglite lazy
 * gate) exactly as before. Schema-init / migration / backfill tests keep
 * exercising their real code path; nothing becomes vacuous. The only thing
 * skipped is the redundant `initdb`.
 *
 * The empty cluster depends only on the PGlite (Postgres) version, never on our
 * app schema, so the cache is keyed by the installed PGlite version and needs no
 * schema-hash invalidation.
 */

// Read the installed PGlite version directly (the package restricts subpath
// access via `exports`, so a fs read is more robust than require()). The empty
// cluster depends only on this version, so it is the whole cache key.
function pgliteVersion(): string {
  try {
    const pkg = path.resolve(process.cwd(), 'node_modules/@electric-sql/pglite/package.json');
    return JSON.parse(readFileSync(pkg, 'utf-8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
const PGLITE_VERSION = pgliteVersion();

const CACHE_DIR = path.resolve(process.cwd(), 'node_modules/.cache/heirloom');
const SNAPSHOT_PATH = path.join(CACHE_DIR, `pglite-empty-${PGLITE_VERSION}.tar`);

/**
 * Build the empty-cluster snapshot if it is not already cached. Idempotent and
 * safe to call from globalSetup. Writes atomically (temp + rename) so a parallel
 * reader never sees a partial file.
 */
export async function buildEmptyClusterSnapshotIfMissing(): Promise<void> {
  if (existsSync(SNAPSHOT_PATH)) return;
  mkdirSync(CACHE_DIR, { recursive: true });
  const db = new PGlite();
  await db.query('SELECT 1'); // triggers initdb; creates no schema
  const blob = await (db as unknown as {
    dumpDataDir(c: string): Promise<Blob>;
  }).dumpDataDir('none');
  await db.close();
  const tmp = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, Buffer.from(await blob.arrayBuffer()));
  renameSync(tmp, SNAPSHOT_PATH);
}

/**
 * Return a fresh PGlite restored from the empty-cluster snapshot — a drop-in
 * replacement for `new PGlite()` in test `beforeAll`/`beforeEach`. Falls back to
 * a plain `new PGlite()` if the snapshot is missing (e.g. globalSetup was
 * skipped), so it is always safe.
 */
export async function newEmptyClusterDb(): Promise<PGlite> {
  if (!existsSync(SNAPSHOT_PATH)) return new PGlite();
  const buf = readFileSync(SNAPSHOT_PATH);
  return PGlite.create({ loadDataDir: new Blob([buf]) });
}
