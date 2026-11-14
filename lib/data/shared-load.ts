import { dataCache } from './cache';

// Loads running now, by cache generation and key (#65, #66).
const pending = new Map<string, Promise<unknown>>();

/**
 * One request per resource at a time: a second caller that asks for the same
 * key while the first is still loading joins it instead of asking again, such
 * as a page that mounts during its hover prefetch, or the phone and desktop
 * layouts of one page. Keyed by cache generation too, so a load that started
 * before a write is never joined after it, and nothing is shared while a write
 * is still running.
 */
export function sharedLoad<T>(cacheKey: string, load: () => Promise<T>): Promise<T> {
    if (dataCache.writing()) return load();
    const key = `${dataCache.generation()}:${cacheKey}`;
    const running = pending.get(key) as Promise<T> | undefined;
    if (running) return running;
    const promise = load().finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
}
