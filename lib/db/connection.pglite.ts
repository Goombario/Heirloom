import { type PGliteInterface } from '@electric-sql/pglite';
import { LeaderChangedError, PGliteWorker } from '@electric-sql/pglite/worker';
import { DatabaseInterruptedError } from '@/lib/data/errors';
import { initializeSchema, SCHEMA_VERSION } from './init-schema';
import { encodeContainer, decodeContainer, type MediaRecord } from './backup-container';
import { RestoreRefusedError } from './restore-errors';
import { refreshPlannerStatsIfStale } from './planner-stats';
import { DURABLE_FLUSH_CHANNEL } from './durable-sync';
import { directQueryClient, type DirectQueryClient } from './direct-query';
import {
  idbDatabaseName,
  readPointer,
  resolveDataDir,
  restoreIntoOtherDataDir,
  writePointer,
  type DataDir,
  type RestoreSteps,
} from './data-dir';

/** Result shape compatible with how query files read pg results (`.rows`, `.rowCount`). */
export interface PgliteQueryResult {
  rows: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  rowCount: number;
}

let dbPromise: Promise<PGliteInterface> | null = null;
let injectedDb: PGliteInterface | null = null;
let workerRef: Worker | null = null;
/** Queries to this page's own worker, used while it is the leader (#1013). */
let direct: DirectQueryClient | null = null;
/**
 * Whether this page's own worker holds the database. Tracked here, not read from
 * PGliteWorker's `isLeader`: the worker posts `leader-now` in the same tick as
 * `ready`, before PGliteWorker starts listening for it, so in Chromium
 * `isLeader` stays false for good. A listener added when the worker is created
 * can't miss it.
 */
let ownWorkerLeads = false;

/**
 * Every tab holds this Web Lock in shared mode while it has the database open,
 * and a restore takes it exclusively. PGlite's worker shares one IndexedDB
 * connection between tabs, so another open tab would otherwise block the
 * restore's delete halfway through (#879).
 */
const TAB_LOCK = 'heirloom-db';
let releaseTabLock: (() => void) | null = null;
/** Set while `loadDatabase` replaces the database; queries are refused meanwhile. */
let restoring = false;

function webLocks(): LockManager | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

async function holdTabLock(): Promise<void> {
  const locks = webLocks();
  if (!locks || releaseTabLock) return;
  await new Promise<void>((granted) => {
    void locks.request(TAB_LOCK, { mode: 'shared' }, () => new Promise<void>((release) => {
      releaseTabLock = release;
      granted();
    }));
  });
}

/** TEST ONLY: inject an in-memory PGlite and reset the lazy state. */
export function __setTestDb(db: PGliteInterface | null): void {
  injectedDb = db;
  dbPromise = null;
  // Reset the mutex so a prior test that errored before release() can't
  // poison the lock and hang the next test.
  lock = Promise.resolve();
}

/** Names of the IndexedDB databases that exist, or `null` when the browser can't list them. */
async function listIdbDatabases(): Promise<Set<string> | null> {
  try {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return null;
    const names = (await indexedDB.databases()).map((d) => d.name);
    return new Set(names.filter((name): name is string => typeof name === 'string'));
  } catch {
    return null;
  }
}

/**
 * The data directory to open (#951), resolved while this tab holds the shared
 * tab lock, so no restore is switching it meanwhile. A leftover from an
 * interrupted restore is deleted in the background.
 */
async function resolveLiveDataDir(): Promise<DataDir> {
  const pointer = readPointer();
  const { open, leftover } = resolveDataDir(pointer, await listIdbDatabases());
  if (open !== pointer) {
    try { writePointer(open); } catch { /* resolved again on the next load */ }
  }
  if (leftover) void deleteIdbDatabase(idbDatabaseName(leftover)).catch(() => {});
  return open;
}

async function createDb(): Promise<PGliteInterface> {
  if (injectedDb) return injectedDb;
  const dataDir = await resolveLiveDataDir();
  const worker = new Worker(new URL('./pglite-worker.ts', import.meta.url), {
    type: 'module',
  });
  workerRef = worker;
  ownWorkerLeads = false;
  worker.addEventListener('message', (event: MessageEvent) => {
    if ((event.data as { type?: unknown } | null)?.type === 'leader-now' && workerRef === worker) ownWorkerLeads = true;
  });
  direct = directQueryClient(worker);
  // Tabs elect a leader per data directory, so every tab sharing a leader has
  // the same database open.
  return PGliteWorker.create(worker, { dataDir });
}

/**
 * Run statements against the worker, failing fast if the tab serving the
 * database changes meanwhile (#1009).
 *
 * Tabs share one PGlite through leader election. After a reload, the new page
 * can briefly be served by the old page's worker; when that worker dies, a call
 * in flight either rejects with `LeaderChangedError` or is posted to a channel no
 * one listens on and never settles. Racing each call against the leader change
 * turns both into an error the caller can handle. Once a change has happened,
 * every later call through the same watch is refused: statements meant for one
 * transaction must not run outside it on the new leader.
 */
interface LeaderWatch {
  run<T>(op: () => Promise<T>): Promise<T>;
  readonly interrupted: boolean;
  stop(): void;
}

function watchLeader(db: PGliteInterface): LeaderWatch {
  const subscribe = (db as Partial<Pick<PGliteWorker, 'onLeaderChange'>>).onLeaderChange;
  if (typeof subscribe !== 'function') return { run: (op) => op(), interrupted: false, stop: () => {} };
  let interrupted = false;
  let fail!: (err: Error) => void;
  const changed = new Promise<never>((_, reject) => { fail = reject; });
  changed.catch(() => {});
  const stop = subscribe.call(db, () => {
    interrupted = true;
    fail(new LeaderChangedError());
  });
  return {
    run(op) {
      if (interrupted) return Promise.reject(new LeaderChangedError());
      const pending = op();
      // The losing call may still settle later; nothing waits on it.
      pending.catch(() => {});
      return Promise.race([pending, changed]);
    },
    get interrupted() { return interrupted; },
    stop,
  };
}

/** How many times a read is re-run after the leader changes under it. */
const LEADER_CHANGE_ATTEMPTS = 3;

/** A statement that can't change data, so re-running it after a leader change is safe. */
function isReadOnly(text: string): boolean {
  return /^\s*(SELECT|SHOW|EXPLAIN|VALUES|TABLE)\b/i.test(text);
}

async function waitForLeader(db: PGliteInterface): Promise<void> {
  await (db as Partial<Pick<PGliteWorker, 'waitReady'>>).waitReady;
}

/**
 * Ensure the schema exists and is at the current `SCHEMA_VERSION`, then return.
 *
 * The IndexedDB-backed PGlite VFS flushes to IndexedDB after every statement,
 * so running the full ~80-statement `initializeSchema` on every page hard-load
 * costs ~20s even when every statement is a no-op. Two optimizations:
 *   1. **Gate** — a `_SchemaMeta` row records the version after a successful
 *      init. On a subsequent load two cheap catalog reads (no write) skip the
 *      whole init when the stored version already matches.
 *   2. **One transaction** — when init *does* run (first ever load, or after a
 *      version bump) the statements run inside a single BEGIN..COMMIT, so the
 *      VFS flushes to IndexedDB once at COMMIT instead of ~80 times. This keeps
 *      normal user-write durability unchanged (only this batch is wrapped).
 */
async function ensureSchema(db: Pick<PGliteInterface, 'query'>): Promise<void> {
  // `to_regclass` returns NULL (it does NOT throw) when "_SchemaMeta" is absent,
  // so a first-ever load falls through to init WITHOUT PGlite logging a
  // "relation does not exist" error to the console. On the warm path both reads
  // are cheap catalog lookups and skip the ~80-statement init.
  const reg = await db.query<{ ok: boolean }>(
    `SELECT to_regclass('"_SchemaMeta"') IS NOT NULL AS ok`
  );
  if (reg.rows[0]?.ok) {
    const v = await db.query<{ v: number }>(`SELECT MAX("Version") AS v FROM "_SchemaMeta"`);
    if ((v.rows[0]?.v ?? -1) >= SCHEMA_VERSION) return;
  }

  await db.query('BEGIN');
  try {
    await initializeSchema({ query: (text, params) => db.query(text, params as unknown[]) });
    await db.query('CREATE TABLE IF NOT EXISTS "_SchemaMeta" ("Version" INTEGER NOT NULL)');
    await db.query('DELETE FROM "_SchemaMeta"');
    await db.query('INSERT INTO "_SchemaMeta" ("Version") VALUES ($1)', [SCHEMA_VERSION]);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

/**
 * `ensureSchema` on the worker. It is idempotent (the version gate re-checks
 * what committed), so an attempt cut off by a leader change just runs again.
 */
async function ensureSchemaOnLeader(db: PGliteInterface): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const watch = watchLeader(db);
    try {
      await ensureSchema({
        query: ((text: string, params?: unknown[]) => watch.run(() => db.query(text, params))) as PGliteInterface['query'],
      });
      return;
    } catch (err) {
      if (!watch.interrupted && !(err instanceof LeaderChangedError)) throw err;
      if (attempt >= LEADER_CHANGE_ATTEMPTS) throw new DatabaseInterruptedError();
      await waitForLeader(db);
    } finally {
      watch.stop();
    }
  }
}

/** Lazily create the PGlite instance and run schema init exactly once. */
function getDb(): Promise<PGliteInterface> {
  // A query issued mid-restore (a background refetch, say) would re-open the
  // worker and block the restore's IndexedDB delete.
  if (restoring) return Promise.reject(new Error('The local database is being restored'));
  if (!dbPromise) {
    dbPromise = (async () => {
      if (!injectedDb) await holdTabLock();
      const db = await createDb();
      await ensureSchemaOnLeader(db);
      if (!injectedDb) scheduleStaleStatsRefresh();
      return db;
    })().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** How long after open to check the planner's statistics, so the first page's reads go first. */
const STATS_CHECK_DELAY_MS = 5_000;

/**
 * PGlite has no autovacuum, so nothing ever refreshes the planner's statistics
 * (#1268). A while after the database opens, analyze it if `People` has grown
 * or shrunk well past what the planner last saw: a tree imported before
 * imports analyzed, a restored backup, or one grown by hand. Best-effort.
 */
function scheduleStaleStatsRefresh(): void {
  setTimeout(() => {
    void refreshPlannerStatsIfStale((text) => query(text)).catch(() => { /* next open retries */ });
  }, STATS_CHECK_DELAY_MS);
}

/**
 * Fire-and-forget: start the worker spawn + WASM instantiate + schema-init
 * chain without waiting on it. Safe to call before any real query, or more
 * than once — getDb() memoizes internally, so this only ever moves the same
 * work earlier, never duplicates it.
 */
export function warmDb(): void {
  void getDb();
}

// PGlite is a single connection. Serialize every query/transaction through a
// promise-chain mutex so a held client (BEGIN..COMMIT) blocks other queries.
let lock: Promise<void> = Promise.resolve();
function acquire(): Promise<() => void> {
  let release!: () => void;
  const next = new Promise<void>((res) => {
    release = res;
  });
  const prior = lock;
  lock = prior.then(() => next);
  return prior.then(() => release);
}

/**
 * Run one statement: straight to this page's worker when it holds the database,
 * else through PGliteWorker to whichever tab does. A leader keeps the database
 * until its page closes, so a page that is the leader stays one.
 */
function runStatement(db: PGliteInterface, text: string, params?: unknown[]) {
  if (direct && ownWorkerLeads && !injectedDb) return direct.query(text, params);
  return db.query(text, params as unknown[]);
}

function wrap(r: { rows: unknown[]; affectedRows?: number }): PgliteQueryResult {
  // PGlite returns affectedRows=0 for SELECT queries (not undefined), so we
  // cannot use ?? — use affectedRows only when > 0 (DML), otherwise fall back
  // to rows.length (SELECT). This matches pg's rowCount behaviour.
  const rowCount = (r.affectedRows != null && r.affectedRows > 0)
    ? r.affectedRows
    : r.rows.length;
  return { rows: r.rows as any[], rowCount }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * PGlite 0.4 reads a bind message's parameter count as a signed 16-bit number,
 * so a statement with 32,768 or more parameters doesn't fail: it desyncs the
 * connection, and every later query returns no rows. Postgres allows 65,535.
 * Batch writers chunk under this; anything over it throws here instead.
 */
export const PGLITE_MAX_BIND_PARAMS = 32_767;

function assertBindParams(params: unknown[] | undefined): void {
  if (params && params.length > PGLITE_MAX_BIND_PARAMS) {
    throw new Error(`Statement binds ${params.length} parameters; PGlite allows ${PGLITE_MAX_BIND_PARAMS}`);
  }
}

/**
 * Wait until everything written so far is in IndexedDB (#1008). Queries return
 * before their flush finishes (`relaxedDurability`), so every local write calls
 * this before it reports success (lib/data/local/durable-writes.ts, #1033); a
 * reload can't lose it after that.
 */
export async function flushToDisk(): Promise<void> {
  // The worker starts a full flush on this notification, and the flush PGlite
  // runs after the statement waits for it (lib/db/durable-sync.ts).
  await query(`NOTIFY ${DURABLE_FLUSH_CHANNEL}`);
}

export async function query(text: string, params?: unknown[]): Promise<PgliteQueryResult> {
  assertBindParams(params);
  const db = await getDb();
  const release = await acquire();
  try {
    for (let attempt = 1; ; attempt++) {
      const watch = watchLeader(db);
      try {
        return wrap(await watch.run(() => runStatement(db, text, params)));
      } catch (err) {
        if (!(err instanceof LeaderChangedError)) throw err;
        // A write may or may not have landed on the old leader: say so rather
        // than run it twice. A read just runs again on the new one.
        if (!isReadOnly(text) || attempt >= LEADER_CHANGE_ATTEMPTS) throw new DatabaseInterruptedError();
        await waitForLeader(db);
      } finally {
        watch.stop();
      }
    }
  } finally {
    release();
  }
}

export interface PgliteClient {
  query(text: string, params?: unknown[]): Promise<PgliteQueryResult>;
  release(): void;
}

export async function getClient(): Promise<PgliteClient> {
  const db = await getDb();
  const release = await acquire();
  let released = false;
  // A client usually holds a transaction. If the leader changes, the old
  // worker's uncommitted statements die with it, and later ones would run
  // outside the transaction on the new leader; so the client stops working (#1009).
  const watch = watchLeader(db);
  return {
    query: async (text, params) => {
      assertBindParams(params);
      // Nothing is left to roll back; let the caller's error path finish.
      if (watch.interrupted && /^\s*ROLLBACK\b/i.test(text)) return { rows: [], rowCount: 0 };
      try {
        return wrap(await watch.run(() => runStatement(db, text, params)));
      } catch (err) {
        if (err instanceof LeaderChangedError) throw new DatabaseInterruptedError();
        throw err;
      }
    },
    release: () => {
      if (!released) {
        released = true;
        watch.stop();
        release();
      }
    },
  };
}

export async function closePool(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    dbPromise = null;
    // Wait for any in-flight query/transaction holder to finish before closing.
    await lock;
    await db.close();
  }
  // Terminate the backing worker so it releases its IndexedDB handle. Required
  // before deleteDatabase() during a restore — an open handle blocks the delete.
  if (workerRef) {
    workerRef.terminate();
    workerRef = null;
  }
  direct?.close();
  direct = null;
  ownWorkerLeads = false;
  releaseTabLock?.();
  releaseTabLock = null;
}

/**
 * Export the entire database (including MediaBlob bytea) as a tar archive.
 * Returns a Blob the caller can offer as a file download or upload to Drive.
 * Only callable in local/PGlite mode — the hosted build never reaches this code.
 *
 * `compression` defaults to `'auto'` (gzip where the runtime supports it). The
 * uncompressed physical datadir includes indexes, WAL, un-VACUUMed bloat, the
 * `MediaThumb` table and the full `Audit` log, so gzip typically shrinks a real
 * backup several-fold — worth it for a Drive upload. `loadDataDir` (in
 * `loadDatabase`/`validateDump`) auto-detects gzip vs. plain, so restore works
 * for both old uncompressed `.tar` backups and new compressed ones. Pass
 * `'none'` for the transient in-memory rollback snapshot, where dump speed
 * matters more than size and the blob never leaves the process.
 */
export async function dumpDatabase(
  compression: 'auto' | 'gzip' | 'none' = 'auto',
): Promise<Blob> {
  const db = await getDb();
  // returns a Blob in PGlite 0.4+
  const blob = await (db as unknown as { dumpDataDir(compression: string): Promise<Blob> }).dumpDataDir(compression);
  return blob;
}

/** gzip a Blob via the platform CompressionStream (browser + Node 18+). */
async function gzipBlob(input: Blob): Promise<Blob> {
  const stream = input.stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

/** gunzip a Blob to text via the platform DecompressionStream. */
async function gunzipToText(input: Blob): Promise<string> {
  const stream = input.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * Turn a PHYSICAL datadir blob into a gzipped METADATA-only SQL dump: load it
 * into a throwaway main-thread PGlite, drop the two media tables' DATA (their
 * table DEFINITIONS are still emitted — restore relies on them), and pgDump the
 * rest. Media travels separately as raw binary, so keeping it out of the pgDump
 * SQL avoids the ~4× hex-encoded bytea string that dominated the v1 backup peak.
 *
 * `TRUNCATE` (rather than pg_dump's `--exclude-table-data`) is deliberate: the
 * pg_dump pattern folds an unquoted name to lowercase and would not match the
 * case-sensitive `"MediaBlob"`/`"MediaThumb"` identifiers. Mutating the throwaway
 * is safe — it exists only to be dumped.
 *
 * Also returns the snapshot's `MediaBlob` ids, read before the TRUNCATE, so the
 * media half of the backup can be taken from the same moment as the metadata
 * (#878).
 *
 * The datadir blob reference is released before pgDump so GC can reclaim it,
 * turning "blob + throwaway" into ~"throwaway" alone. Kept separate from
 * dumpDatabaseLogical() so it is unit-testable without the worker.
 */
export async function datadirToMetadataGz(physical: Blob): Promise<{ metaGz: Blob; mediaIds: number[] }> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgDump } = await import('@electric-sql/pglite-tools/pg_dump');
  const tmp = await PGlite.create({ loadDataDir: physical });
  // PGlite has copied the datadir into its WASM VFS by now; drop our reference so
  // GC can reclaim it before the memory-heavy dump.
  physical = null as unknown as Blob;
  try {
    const ids = await tmp.query<{ MediaId: number }>('SELECT "MediaId" FROM "MediaBlob" ORDER BY "MediaId"');
    await tmp.exec('TRUNCATE "MediaBlob", "MediaThumb";');
    const sql = await (await pgDump({ pg: tmp })).text();
    return { metaGz: await gzipBlob(new Blob([sql])), mediaIds: ids.rows.map((r) => r.MediaId) };
  } finally {
    await tmp.close();
  }
}

/**
 * Stream the snapshot's MediaBlob rows out of the live worker as raw bytes, one
 * blob at a time. Only ids the metadata snapshot holds are read, so a photo added
 * after the snapshot can't leave a blob without its Media row (which made the
 * whole backup unrestorable). A photo deleted after the snapshot fails the
 * backup rather than producing one that silently lacks it (#878).
 */
async function* streamWorkerMediaBlobs(mediaIds: number[]): AsyncGenerator<MediaRecord> {
  for (const mediaId of mediaIds) {
    const r = await query('SELECT "Data" FROM "MediaBlob" WHERE "MediaId" = $1', [mediaId]);
    const data = (r.rows[0] as { Data: Uint8Array } | undefined)?.Data;
    if (!data) throw new Error('A photo was deleted while the backup was running; run the backup again');
    yield { mediaId, data: new Uint8Array(data) };
  }
}

/**
 * Produce a `.hlbak` hybrid backup of the live database: a gzipped metadata-only
 * SQL dump (no media bytes) followed by raw MediaBlob bytes streamed from the
 * worker one at a time. Keeps media out of the pgDump hex string — the mobile
 * memory win. Local/PGlite mode only.
 */
export async function dumpDatabaseLogical(): Promise<Blob> {
  // 'none' — the physical dump is a transient we immediately reload into a
  // throwaway; gzipping it here would be wasted work (metadata is gzipped inside
  // datadirToMetadataGz, media is raw).
  return logicalBackupFromSnapshot(await dumpDatabase('none'));
}

/**
 * The second half of `dumpDatabaseLogical`, given its physical snapshot. Split
 * out so a test can write to the live database between the two halves (#878).
 */
export async function logicalBackupFromSnapshot(physical: Blob): Promise<Blob> {
  const { metaGz, mediaIds } = await datadirToMetadataGz(physical);
  return encodeContainer(metaGz, streamWorkerMediaBlobs(mediaIds));
}

/**
 * Turn a `.hlbak` container back into a physical datadir: verify + parse the
 * container (bad magic/version throws HERE, before any caller touches the
 * persisted DB), exec the metadata SQL into a throwaway main-thread PGlite,
 * re-insert each streamed MediaBlob (Media parents already exist from the
 * metadata exec, so the FK holds), and dump the result as a datadir.
 */
export async function logicalToDatadir(container: Blob): Promise<Blob> {
  return (await rebuildDatadir(container, false)).datadir;
}

/** Whole-database totals: what a restore replaces, and what a backup holds (BK-1). */
export interface DatabaseTotals {
  trees: number;
  people: number;
  families: number;
  media: number;
}

// Every tree, not the active one: a restore replaces the whole database.
const DATABASE_TOTALS_SQL = `SELECT
  (SELECT COUNT(*) FROM "Trees")::int    AS trees,
  (SELECT COUNT(*) FROM "People")::int   AS people,
  (SELECT COUNT(*) FROM "Families")::int AS families,
  (SELECT COUNT(*) FROM "Media")::int    AS media`;

/**
 * Read a `.hlbak` without touching the live database: rebuild its datadir in a
 * throwaway PGlite and count what it holds, so the restore confirmation can
 * compare it with this browser's data. A bad file throws here, before the
 * confirmation opens. Pass the returned datadir to `loadDatabase` to restore it
 * without rebuilding it a second time.
 */
export async function inspectBackupLogical(container: Blob): Promise<{ datadir: Blob; totals: DatabaseTotals }> {
  const { datadir, totals } = await rebuildDatadir(container, true);
  return { datadir, totals: totals! };
}

/**
 * Refuse a database written by a newer build. `ensureSchema` only upgrades, so
 * older code would otherwise run silently against a schema it doesn't know
 * (#879). A database with no `_SchemaMeta` predates the gate and is older.
 */
async function assertSchemaNotNewer(db: Pick<PGliteInterface, 'query'>): Promise<void> {
  const reg = await db.query<{ ok: boolean }>(`SELECT to_regclass('"_SchemaMeta"') IS NOT NULL AS ok`);
  if (!reg.rows[0]?.ok) return;
  const v = await db.query<{ v: number | null }>(`SELECT MAX("Version") AS v FROM "_SchemaMeta"`);
  if ((v.rows[0]?.v ?? -1) > SCHEMA_VERSION) throw new RestoreRefusedError('newer_backup');
}

// Counting is opt-in, so a plain restore never depends on the counted tables.
async function rebuildDatadir(container: Blob, countTotals: boolean): Promise<{ datadir: Blob; totals: DatabaseTotals | null }> {
  const { metaGz, blobs } = await decodeContainer(container);
  const metaSql = await gunzipToText(metaGz);
  const { PGlite } = await import('@electric-sql/pglite');
  const tmp = await PGlite.create();
  try {
    await tmp.exec(metaSql);
    await tmp.exec('SET search_path TO public;');
    await assertSchemaNotNewer(tmp);
    for await (const { mediaId, data } of blobs) {
      // A backup written before #878 can carry a blob whose Media row was added
      // after its metadata snapshot. Skip it rather than fail the FK and with it
      // the whole restore; the photo wasn't part of that snapshot anyway.
      await tmp.query(
        `INSERT INTO "MediaBlob" ("MediaId", "Data")
         SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM "Media" WHERE "Id" = $1)`,
        [mediaId, data],
      );
    }
    const totals = countTotals ? (await tmp.query<DatabaseTotals>(DATABASE_TOTALS_SQL)).rows[0] : null;
    return { datadir: await tmp.dumpDataDir('none'), totals };
  } finally {
    await tmp.close();
  }
}

/**
 * Whether this browser holds anything worth backing up: a person, in any tree
 * (#938). The warnings start with the first person, as Home's welcome screen
 * does, so an empty app isn't nagged to back up.
 */
export async function hasBackupWorthyData(): Promise<boolean> {
  const result = await query(`SELECT EXISTS (SELECT 1 FROM "People") AS "hasData"`);
  return (result.rows[0] as { hasData: boolean }).hasData === true;
}

/** The live database's totals, for the restore confirmation (BK-1). */
export async function getDatabaseTotals(): Promise<DatabaseTotals> {
  return (await query(DATABASE_TOTALS_SQL)).rows[0] as DatabaseTotals;
}


/** How long a blocked IndexedDB delete may wait for the blocking connection to close. */
const DELETE_BLOCKED_TIMEOUT_MS = 10_000;

/**
 * Delete a PGlite IndexedDB database, resolving once it is gone.
 *
 * A blocked delete (some connection is still open) is NOT done: it stays queued
 * and completes whenever that connection closes. So it gets a grace period and
 * then rejects (#879). `onLateDelete` runs if the queued delete completes after
 * that, so the caller can put its rollback copy back.
 */
function deleteIdbDatabase(name: string, onLateDelete?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => {
        if (settled) onLateDelete?.();
        finish(resolve);
      };
      req.onerror = () => finish(() => reject(new Error(`Could not clear local database "${name}"`)));
      req.onblocked = () => {
        timer ??= setTimeout(
          () => finish(() => reject(new RestoreRefusedError('other_tabs'))),
          DELETE_BLOCKED_TIMEOUT_MS,
        );
      };
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  });
}

/**
 * Validate that `dump` is a loadable PostgreSQL data directory by booting a
 * throwaway **in-memory** PGlite from it and reading its schema version. Throws
 * if the dump is missing, corrupt, not a PGlite tarball, or written by a newer
 * build — WITHOUT touching the persisted database. This is what makes restore
 * safe: a bad backup file is rejected here, before any existing data is cleared.
 */
export async function validateDump(dump: Blob): Promise<void> {
  const { PGlite } = await import('@electric-sql/pglite');
  // No dataDir → in-memory FS, so loadDataDir always applies (never "already exists").
  const probe = await PGlite.create({ loadDataDir: dump });
  try {
    await assertSchemaNotNewer(probe);
  } finally {
    await probe.close();
  }
}

/** Run `fn` holding the tab lock exclusively, or refuse when another tab has the database open. */
async function withExclusiveDb<T>(fn: () => Promise<T>): Promise<T> {
  const locks = webLocks();
  if (!locks) return fn();
  return locks.request(TAB_LOCK, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) throw new RestoreRefusedError('other_tabs');
    return fn();
  });
}

/**
 * Mark this tab as restoring: queries are refused (a background refetch would
 * reopen the worker), and leaving the page asks for confirmation. Returns the
 * function that ends it.
 */
function beginRestore(): () => void {
  const guardUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
  const hasWindow = typeof window !== 'undefined';
  restoring = true;
  if (hasWindow) window.addEventListener('beforeunload', guardUnload);
  return () => {
    restoring = false;
    if (hasWindow) window.removeEventListener('beforeunload', guardUnload);
  };
}

/** Whether the browser's storage has room for the backup next to the live data. */
async function hasRoomForSecondCopy(dump: Blob): Promise<boolean> {
  let estimate: StorageEstimate | null = null;
  try {
    estimate = typeof navigator !== 'undefined' && navigator.storage?.estimate
      ? await navigator.storage.estimate()
      : null;
  } catch {
    estimate = null;
  }
  // Unknown: try it. Running out of space while writing the copy fails the
  // restore with the live data untouched.
  if (estimate?.quota == null || estimate.usage == null) return true;
  // IDBFS keeps each file as one record, plus IndexedDB's own overhead.
  return estimate.quota - estimate.usage > dump.size * 1.5;
}

/**
 * Replace the current database contents with the given dump blob (previously
 * produced by `dumpDatabase()`), safely.
 *
 * The dump is validated in memory first (bad file or newer schema → throw,
 * existing DB untouched). Then, when the storage has room for two copies, it is
 * loaded into the data directory that isn't live, read back from there, and the
 * app is pointed at it before the old one is deleted (#951), so a crash or a
 * killed tab at any step leaves one complete database. Without the room, it
 * falls back to replacing the database in place (`loadInPlace`).
 *
 * IMPORTANT: callers should reload the page after this returns so all in-memory
 * caches (React state, ensureLocalUser cache, etc.) are cleared.
 */
export async function loadDatabase(dump: Blob): Promise<void> {
  await validateDump(dump);
  if (await hasRoomForSecondCopy(dump)) {
    await loadIntoOtherDataDir(dump);
    return;
  }
  console.warn('Not enough storage to keep the current data during the restore; replacing it in place.');
  await loadInPlace(dump);
}

async function loadIntoOtherDataDir(dump: Blob): Promise<void> {
  const { PGlite } = await import('@electric-sql/pglite');
  const steps: RestoreSteps = {
    deleteDb: (dir) => deleteIdbDatabase(idbDatabaseName(dir)),
    writeDb: async (dir, datadir) => {
      const db = await PGlite.create(dir, { loadDataDir: datadir });
      await db.close();
    },
    // A fresh instance reads the copy back from IndexedDB, not from memory.
    verifyDb: async (dir) => {
      const db = await PGlite.create(dir);
      try {
        await assertSchemaNotNewer(db);
        const people = await db.query<{ ok: boolean }>(`SELECT to_regclass('"People"') IS NOT NULL AS ok`);
        if (people.rows[0]?.ok) await db.query('SELECT COUNT(*) FROM "People"');
      } finally {
        await db.close();
      }
    },
    writePointer: (dir) => writePointer(dir),
  };

  const endRestore = beginRestore();
  try {
    await closePool();
    await withExclusiveDb(async () => {
      const { open } = resolveDataDir(readPointer(), await listIdbDatabases());
      await restoreIntoOtherDataDir(steps, open, dump);
    });
  } finally {
    endRestore();
  }
}

/**
 * Replace the live database in place: the path for a device without room for
 * a second copy. PGlite refuses `loadDataDir` into a data directory that already
 * exists, so IndexedDB is cleared first:
 *   1. snapshot the current DB as a rollback copy (no snapshot → refuse);
 *   2. with every tab's connection closed, terminate the worker + clear IndexedDB;
 *   3. load the validated dump; on any failure, restore the rollback copy.
 *
 * The rollback copy lives only in memory, so steps 2–3 also ask the browser to
 * confirm leaving the page (#879).
 */
async function loadInPlace(dump: Blob): Promise<void> {
  const { PGlite } = await import('@electric-sql/pglite');

  // 1. Rollback snapshot of the current data. getDb() creates an empty database
  //    when there is none, so a failure here is real (out of memory on a large
  //    tree, say) and the restore must not go ahead without it. Uncompressed:
  //    it's transient and in-memory, so dump speed beats size here.
  let rollback: Blob;
  try {
    rollback = await dumpDatabase('none');
  } catch {
    throw new RestoreRefusedError('no_rollback');
  }

  // Set once the exclusive lock is held, so no restore elsewhere is switching it.
  let dataDir: DataDir = readPointer();
  const writeBack = async (datadir: Blob) => {
    const db = await PGlite.create(dataDir, { loadDataDir: datadir });
    await db.close();
  };
  const endRestore = beginRestore();

  // A blocked delete that timed out is still queued, and wipes the database
  // whenever the blocking connection closes. Until then this tab stays in
  // restore mode (queries refused, leaving guarded), so its own reopen can't
  // race the rollback write-back; once the delete lands, the rollback goes back.
  let lateDeletePending = false;
  const onLateDelete = () => { void writeBack(rollback).catch(() => {}).finally(endRestore); };
  const deleteOrPend = async () => {
    try {
      await deleteIdbDatabase(idbDatabaseName(dataDir), onLateDelete);
    } catch (err) {
      if (err instanceof RestoreRefusedError) lateDeletePending = true;
      throw err;
    }
  };

  // 2. Release this tab's handle, then clear IndexedDB once no tab holds it.
  try {
    await closePool();
    await withExclusiveDb(async () => {
      dataDir = resolveDataDir(readPointer(), await listIdbDatabases()).open;
      await deleteOrPend();

      // 3. Boot fresh from the validated dump, writing it into IndexedDB.
      try {
        await writeBack(dump);
      } catch (err) {
        // Unexpected write failure after clearing — put the user's data back.
        try {
          await deleteOrPend();
          await writeBack(rollback);
        } catch {
          // Rollback also failed (or is waiting on a blocked delete); surface the error.
        }
        throw err;
      }
    });
  } finally {
    if (!lateDeletePending) endRestore();
  }
}
