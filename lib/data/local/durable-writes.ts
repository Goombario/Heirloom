import { flushToDisk } from '@/lib/db/connection.pglite';
import { isReadMethod } from '../cache-invalidation';
import { asStorageLimitError } from '../errors';
import type { DataClient } from '../types';

let inFlight = 0;
const guardUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };

function holdPage(): void {
  if (inFlight++ === 0 && typeof window !== 'undefined') window.addEventListener('beforeunload', guardUnload);
}

function releasePage(): void {
  if (--inFlight === 0 && typeof window !== 'undefined') window.removeEventListener('beforeunload', guardUnload);
}

/**
 * Resolve a write only once it is in IndexedDB (#1033).
 *
 * Queries return before their IndexedDB flush finishes (`relaxedDurability`),
 * so a reload a second after a save could lose it, or the later statements of
 * it. Each write waits for one durable flush, as imports did since #1008, so a
 * page that says "saved" can be reloaded. Leaving the page while a write and its
 * flush are running asks for confirmation where the browser allows it.
 *
 * A failed flush fails the write: the change is in memory but would not survive
 * a reload. A failed write is flushed too, since it may have saved part of its
 * statements, and the write's own error is what the caller sees.
 */
async function durably<T>(write: () => Promise<T>): Promise<T> {
  holdPage();
  try {
    let result: T;
    try {
      result = await write();
    } catch (err) {
      await flushToDisk().catch(() => {});
      throw err;
    }
    try {
      await flushToDisk();
    } catch (err) {
      throw asStorageLimitError(err) ?? err;
    }
    return result;
  } finally {
    releasePage();
  }
}

function wrapSubClient<T extends object>(sub: T): T {
  return new Proxy(sub, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      // The same read/write split as cache invalidation: a method is a write
      // unless it is known to be a read, so a missed write still waits.
      if (typeof value !== 'function' || typeof prop !== 'string' || isReadMethod(prop)) {
        return value;
      }
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        return result instanceof Promise ? durably(() => result) : result;
      };
    },
  });
}

/**
 * Run many writes under one durable flush (#1259).
 *
 * IDBFS writes each changed file whole, and photo bytes all live in one growing
 * table file, so a flush per photo rewrites the whole media store each time.
 * `run` gets a client whose writes don't wait for their own flush. PGlite still
 * flushes in the background after each query, and coalesces those flushes, so
 * the batch isn't held up by them. The batch resolves once one final durable
 * flush is done, and fails the way a single write does. Leaving the page asks
 * for confirmation for the whole batch.
 */
export function durableBatch<T>(batchClient: DataClient, run: (client: DataClient) => Promise<T>): Promise<T> {
  return durably(() => run(batchClient));
}

/** Decorates the local DataClient so each write resolves once it is on disk. */
export function withDurableWrites(client: DataClient): DataClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const sub = Reflect.get(target, prop, receiver);
      return sub && typeof sub === 'object' ? wrapSubClient(sub as object) : sub;
    },
  }) as DataClient;
}
