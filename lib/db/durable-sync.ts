/** The channel a page notifies to ask for one durable flush (#1008). */
export const DURABLE_FLUSH_CHANNEL = 'heirloom_durable_flush';

interface FlushableDb {
    readonly waitReady: Promise<void>;
    listen(channel: string, callback: () => void): Promise<unknown>;
    syncToFs(): Promise<void>;
}

export interface DurableFlushWaiter {
    /**
     * Wait for a durable flush a statement asked for, if one is running, and
     * start nothing otherwise. For a caller whose query already started PGlite's
     * own relaxed flush, where `syncToFs()` would only start a second one (#1277).
     */
    waitForDurableFlush(): Promise<void>;
}

/**
 * Hand the worker's RPC layer a PGlite that can be asked for one durable flush (#1008).
 *
 * With `relaxedDurability`, a query returns before its IndexedDB flush finishes.
 * That's fine per query, but an import is one large write, and a reload in the
 * next second or two could lose all of it. The page asks for a durable flush by
 * running `NOTIFY heirloom_durable_flush`: the notification starts a full flush,
 * and the `syncToFs()` call the page makes after that query waits for it. Every
 * other query's flush stays relaxed. PGlite's own per-query flush runs on the
 * instance itself, not this proxy.
 */
export function withDurableSync<T extends FlushableDb>(db: T, flush: () => Promise<void>): T & DurableFlushWaiter {
    let durable: Promise<void> | null = null;
    const request = () => {
        // A new flush every time: one already running may predate this caller's
        // writes. Flushes run one at a time (serializeFlushes), so it ends last.
        const run = flush();
        durable = run;
        const settle = () => { if (durable === run) durable = null; };
        // A failure reaches the waiting page through syncToFs; this only settles.
        run.then(settle, (err: unknown) => { console.error('Durable flush failed:', err); settle(); });
    };
    void db.waitReady
        .then(() => db.listen(DURABLE_FLUSH_CHANNEL, request))
        .catch((err: unknown) => { console.error('Durable flush listener failed:', err); });
    // A failed durable flush rejects here, so the import doesn't report success.
    const syncToFs = async () => {
        if (durable) await durable;
        else await db.syncToFs();
    };
    const waitForDurableFlush = async () => {
        if (durable) await durable;
    };
    return new Proxy(db as T & DurableFlushWaiter, {
        get(target, prop) {
            if (prop === 'syncToFs') return syncToFs;
            if (prop === 'waitForDurableFlush') return waitForDurableFlush;
            const value = Reflect.get(target, prop, target);
            // Bound to the instance: PGlite keeps its state in private fields.
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}
