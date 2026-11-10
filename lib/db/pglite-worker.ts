import { IdbFs, PGlite } from '@electric-sql/pglite';
import { worker } from '@electric-sql/pglite/worker';
import { retryFlushOnEnoent, serializeFlushes, skipCleanFlushes } from './idbfs-flush-retry';
import { withDurableSync } from './durable-sync';
import { DATA_DIRS } from './data-dir';
import { serveDirectQueries, type DirectQueryDb } from './direct-query';

// Patched on the prototype, not passed as `fs`: PGlite copies its options into
// the throwaway initdb instance on a first run, which would then share (and
// close) this filesystem. The patch only affects this worker.
IdbFs.prototype.syncToFs = serializeFlushes(skipCleanFlushes(retryFlushOnEnoent(IdbFs.prototype.syncToFs)));

// Set once this worker wins the election and opens the database.
let opened!: (db: DirectQueryDb) => void;
const leaderDb = new Promise<DirectQueryDb>((resolve) => { opened = resolve; });
// The page that owns this worker sends its queries straight here (#1013).
serveDirectQueries(self as unknown as DedicatedWorkerGlobalScope, leaderDb);

// Runs inside a Web Worker. Persists the database to IndexedDB so data
// survives reloads. Other tabs, and this page before it is the leader, talk to
// it through PGliteWorker.
worker({
  async init(options) {
    // relaxedDurability: the IndexedDB VFS flushes asynchronously after a query
    // returns instead of blocking the result on the flush. The blocking flush
    // costs ~0.5s PER query, which dominated cold start. The flush still happens
    // (right after the query). Each write through the data client then waits for
    // one durable flush before it reports success (#1033), so only a crash in the
    // middle of a write can lose it.
    // The page names the data directory: a restore switches between two (#951).
    const db = new PGlite(options.dataDir ?? DATA_DIRS[0], { relaxedDurability: true });
    // A page can ask for one full, awaited flush, so a write waits until it's in
    // IndexedDB before saying it's done (#1008, #1033).
    const durable = withDurableSync(db, async () => {
      await db.fs?.syncToFs(false);
    });
    opened(durable);
    return durable;
  },
});
