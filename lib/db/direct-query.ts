/**
 * One message per query between a page and its own PGlite worker (#1013).
 *
 * PGliteWorker sends every query as about 14 BroadcastChannel round trips
 * (query and transaction locks, blob checks, each wire-protocol message, the
 * flush). Browsers route BroadcastChannel through another process, so each trip
 * costs ~2 ms, and a person page's ~40 queries spent over a second just in
 * transit. When this page's own worker is the leader, the page posts the query
 * straight to it instead: one in-process message each way, with the same
 * statement, flush and error behaviour. Other tabs still use PGliteWorker.
 */

/** The worker-side database: PGlite behind `withDurableSync`. */
export interface DirectQueryDb {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; affectedRows?: number }>;
  /** Wait for a durable flush the statement asked for (lib/db/durable-sync.ts). */
  waitForDurableFlush(): Promise<void>;
}

interface DirectQueryRequest {
  type: 'heirloom-direct-query';
  id: number;
  text: string;
  params?: unknown[];
}

interface DirectQueryReply {
  type: 'heirloom-direct-result';
  id: number;
  result?: { rows: unknown[]; affectedRows?: number };
  error?: Record<string, unknown> & { message: string; name: string };
}

/**
 * Structured cloning keeps only an Error's name and message, so copy its own
 * fields too: callers read `code` (23505, a quota error) and `detail`.
 */
function serializeError(err: unknown): NonNullable<DirectQueryReply['error']> {
  if (err && typeof err === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(err)) {
      // Only cloneable plain values; PGlite errors also hold the query and params.
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) fields[key] = value;
    }
    const e = err as { message?: unknown; name?: unknown; code?: unknown };
    // A DOMException (a quota error from the flush) keeps `code` on its prototype.
    if (fields.code === undefined && (typeof e.code === 'string' || typeof e.code === 'number')) fields.code = e.code;
    return { ...fields, message: String(e.message ?? err), name: String(e.name ?? 'Error') };
  }
  return { message: String(err), name: 'Error' };
}

function deserializeError(error: NonNullable<DirectQueryReply['error']>): Error {
  const err = new Error(error.message);
  Object.assign(err, error);
  return err;
}

/** Worker side: answer the owning page's queries once this worker holds the database. */
export function serveDirectQueries(scope: DedicatedWorkerGlobalScope, leaderDb: Promise<DirectQueryDb>): void {
  scope.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as DirectQueryRequest | undefined;
    if (msg?.type !== 'heirloom-direct-query') return;
    void (async () => {
      let reply: DirectQueryReply;
      try {
        const db = await leaderDb;
        const r = await db.query(msg.text, msg.params);
        // `db.query` already started PGlite's own relaxed flush. Only wait for
        // a durable flush the statement asked for: calling `syncToFs()` here,
        // as PGliteWorker's client does, started a second flush whose
        // clean-check walk alone cost ~5 ms a query (#1277).
        await db.waitForDurableFlush();
        reply = { type: 'heirloom-direct-result', id: msg.id, result: { rows: r.rows, affectedRows: r.affectedRows } };
      } catch (err) {
        reply = { type: 'heirloom-direct-result', id: msg.id, error: serializeError(err) };
      }
      try {
        scope.postMessage(reply);
      } catch (err) {
        // A row the browser can't clone must still settle the page's call, or
        // the page would wait forever holding its query lock.
        scope.postMessage({ type: 'heirloom-direct-result', id: msg.id, error: serializeError(err) } satisfies DirectQueryReply);
      }
    })();
  });
}

export interface DirectQueryClient {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; affectedRows?: number }>;
  /** Reject everything in flight, for when the worker is terminated. */
  close(): void;
}

/** Page side: send queries to `worker`, which must be this page's leader worker. */
export function directQueryClient(worker: Worker): DirectQueryClient {
  let nextId = 1;
  const pending = new Map<number, { resolve: (r: { rows: unknown[]; affectedRows?: number }) => void; reject: (e: Error) => void }>();
  worker.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as DirectQueryReply | undefined;
    if (msg?.type !== 'heirloom-direct-result') return;
    const call = pending.get(msg.id);
    if (!call) return;
    pending.delete(msg.id);
    if (msg.error) call.reject(deserializeError(msg.error));
    else call.resolve(msg.result!);
  });
  return {
    query(text, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const request: DirectQueryRequest = { type: 'heirloom-direct-query', id, text, params };
        worker.postMessage(request);
      });
    },
    close() {
      for (const call of pending.values()) call.reject(new Error('The local database was closed'));
      pending.clear();
    },
  };
}
