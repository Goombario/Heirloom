import type { DataClient } from './types';

import { DATA_MODE } from './mode';

export { DATA_MODE, type DataMode } from './mode';

type WriteBatch = <T>(run: (client: DataClient) => Promise<T>) => Promise<T>;

interface Clients {
  client: DataClient;
  batch: WriteBatch;
}

let clientsPromise: Promise<Clients> | null = null;

function getClients(): Promise<Clients> {
  if (!clientsPromise) {
    clientsPromise = (async (): Promise<Clients> => {
      const { withCacheInvalidation } = await import('./cache-invalidation');
      const { withNameOrder } = await import('./name-order');
      if (DATA_MODE === 'local') {
        const { LocalDataClient } = await import('./local');
        const { withDurableWrites, durableBatch } = await import('./local/durable-writes');
        const { rememberDefaultTree } = await import('./local/default-tree');
        rememberDefaultTree();
        const local = new LocalDataClient();
        // Same instance, without the per-write flush: a batch flushes once (#1259).
        const batchClient = withNameOrder(withCacheInvalidation(local));
        return {
          client: withNameOrder(withCacheInvalidation(withDurableWrites(local))),
          batch: (run) => durableBatch(batchClient, run),
        };
      }
      const { HttpDataClient } = await import('./http');
      const client = withNameOrder(withCacheInvalidation(new HttpDataClient()));
      return { client, batch: (run) => run(client) };
    })().catch((err) => {
      // Don't cache a rejected promise — a transient failure (e.g. a code-split
      // chunk or PGlite WASM fetch failing while briefly offline) must be retryable.
      clientsPromise = null;
      throw err;
    });
  }
  return clientsPromise;
}

/**
 * Returns the singleton data client for the current build mode. Async because
 * the implementations are lazy-imported, keeping PGlite's WASM out of the
 * hosted bundle and `pg`-dependent code out of the static bundle.
 */
export async function getDataClient(): Promise<DataClient> {
  return (await getClients()).client;
}

/**
 * Run a loop of writes, such as adding many photos, as one batch (#1259). In the
 * local build each write normally waits for its own IndexedDB flush; inside the
 * batch they don't, and the batch resolves after one flush at the end. Writes
 * made through `client` resolve before they are on disk, so only use it inside
 * `run`. The hosted build just runs `run` with the ordinary client.
 */
export async function withWriteBatch<T>(run: (client: DataClient) => Promise<T>): Promise<T> {
  return (await getClients()).batch(run);
}

export type { DataClient } from './types';
