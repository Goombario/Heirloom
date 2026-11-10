import { dataCache } from './cache';
import type { DataClient } from './types';

// Read-allowlist, not a write-blocklist: a method is a write unless we can prove
// it's a read. The failure modes are asymmetric — a missed write serves STALE
// data (a correctness bug, e.g. `cases.linkMedia`/`unlinkMedia`, which match no
// "write verb"), whereas a misclassified read merely clears the cache too eagerly
// (a recoverable perf cost). So anything not matching a known read shape
// invalidates. New read methods follow the list*/get*/search* convention and stay
// covered; if one doesn't, add it here rather than leaving writes to a verb guess.
const READ_PREFIXES = ['list', 'get', 'search', 'suggest', 'preview'];
// Read methods whose names don't match a READ_PREFIX. Each is a noun-y accessor on
// exactly one sub-client (no write shares the name), so allowlisting is safe:
//   coords  — places.coords, batch place→lat/lng lookup. Missing this meant every
//             person-detail load (which fetches map coords) was treated as a write
//             and cleared the whole cache, defeating the person SWR cache and
//             flashing the detail skeleton on every back-nav.
//   sources — repositories.sources, the sources under a repository.
//   users   — audit.users, the editors of a tree.
//   dependentCount — places.dependentCount, the Edit-pin popover's blast-radius
//             count (docs/superpowers/specs/2026-07-09-places-precision-hierarchy-
//             design.md §6.2). Same failure shape as coords: every popover open
//             would otherwise be treated as a write and clear the whole cache.
//   pinChains — places.pinChains, batch lookup of each place's raw ParentId
//             chain for pin resolution (same design doc §4b). Same failure shape
//             as coords/dependentCount: every place-badge reopen would otherwise
//             be treated as a write and clear the whole cache.
//   descendantCount — people.descendantCount, the person hero's Descendants
//             button label. Same failure shape as coords: it runs on every
//             person-detail view, so treating it as a write would clear the
//             cache on each one and flash skeletons across the app.
//   neighbourhood — dataChecks.neighbourhood, the dates a person's date editor
//             previews a fix against (#832). Treated as a write, each person
//             edit would also throw away the cached data checks (#1269).
const READ_EXACT = new Set(['detail', 'citedBy', 'coords', 'sources', 'users', 'dependentCount', 'pinChains', 'descendantCount', 'neighbourhood']);

export function isReadMethod(name: string): boolean {
  return READ_EXACT.has(name) || READ_PREFIXES.some((p) => name.startsWith(p));
}

/** Wraps each sub-client in a Proxy that clears the cache after any write resolves. */
function wrapSubClient<T extends object>(sub: T): T {
  return new Proxy(sub, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string' || isReadMethod(prop)) {
        return value;
      }
      return (...args: unknown[]) => {
        dataCache.writeStarted();
        let result: unknown;
        try {
          result = (value as (...a: unknown[]) => unknown).apply(target, args);
        } catch (err) {
          dataCache.writeEnded();
          throw err;
        }
        if (result instanceof Promise) {
          return result.then(
            (r) => {
              dataCache.clear();
              dataCache.writeEnded();
              return r;
            },
            (err: unknown) => {
              // A failed write may still have changed something (a batch, say).
              dataCache.clear();
              dataCache.writeEnded();
              throw err;
            },
          );
        }
        dataCache.clear();
        dataCache.writeEnded();
        return result;
      };
    },
  });
}

/** Decorates a DataClient so reads are untouched and writes invalidate the cache. */
export function withCacheInvalidation(client: DataClient): DataClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const sub = Reflect.get(target, prop, receiver);
      if (sub && typeof sub === 'object') {
        return wrapSubClient(sub as object);
      }
      return sub;
    },
  }) as DataClient;
}
