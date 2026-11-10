/** Emscripten's errno for ENOENT. */
const ENOENT = 44;
const FLUSH_ATTEMPTS = 3;

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { errno?: unknown }).errno === ENOENT;
}

type Flush<T> = (this: T, relaxedDurability?: boolean) => Promise<void>;

/**
 * Wrap PGlite's IndexedDB flush so a vanished-file race retries (#713).
 *
 * With `relaxedDurability`, PGlite starts the IndexedDB flush without awaiting
 * it, and Postgres keeps running meanwhile. IDBFS walks the data directory and
 * then reads each file; a temp file Postgres deletes in between fails the flush
 * with ENOENT. The rejection is un-awaited, so it surfaced as an uncaught
 * `ErrnoError`, and the rest of that flush waited for the next query. Each
 * attempt re-walks the directory and re-puts whole files, so retrying is safe.
 */
export function retryFlushOnEnoent<T>(flush: Flush<T>): Flush<T> {
  return async function (this: T, relaxedDurability?: boolean) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await flush.call(this, relaxedDurability);
      } catch (err) {
        if (attempt >= FLUSH_ATTEMPTS || !isEnoent(err)) throw err;
      }
    }
  };
}

/**
 * Run flushes one at a time, in the order they start. Two overlapping IDBFS
 * flushes could each write their own snapshot, and a durable flush (#1008)
 * must finish after every flush that started before it.
 */
export function serializeFlushes<T>(flush: Flush<T>): Flush<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return function (this: T, relaxedDurability?: boolean) {
    const run = tail.then(() => flush.call(this, relaxedDurability));
    tail = run.catch(() => {});
    return run;
  };
}

/** An in-memory (MEMFS) node: a directory's `contents` maps names to child nodes. */
interface MemfsNode {
  mode: number;
  mtime?: number;
  contents?: unknown;
  mounted?: unknown;
}
interface EmscriptenMount { type: unknown; mountpoint: string; root?: MemfsNode }
interface EmscriptenFs {
  root: { mount: EmscriptenMount };
  filesystems: { IDBFS: unknown };
  getMounts(mount: EmscriptenMount): EmscriptenMount[];
  readdir(path: string): string[];
  stat(path: string): { mode: number; mtime: Date | number };
  isDir(mode: number): boolean;
  isLink?(mode: number): boolean;
}

/**
 * Walk a mount's nodes directly, as `FS.stat` would see them, or return false
 * when the tree has something this walk doesn't follow (a link or a nested
 * mount), so the caller can walk by path instead.
 *
 * `FS.stat(path)` resolves the whole path from the root on every call, which
 * made one snapshot of a ~1,200-file database cost ~4.6 ms in Node, more in
 * WebKitGTK, on every query (#1277). Reading the nodes costs ~0.45 ms.
 */
function walkNodes(fs: EmscriptenFs, mount: EmscriptenMount, into: Map<string, number>): boolean {
  if (!mount.root || !isDirectoryContents(mount.root.contents) || !fs.isLink) return false;
  const found = new Map<string, number>();
  const pending: Array<[MemfsNode, string]> = [[mount.root, mount.mountpoint]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [dir, dirPath] = next;
    for (const [name, child] of Object.entries(dir.contents as Record<string, MemfsNode>)) {
      if (fs.isLink(child.mode) || child.mounted || typeof child.mtime !== 'number') return false;
      const path = `${dirPath}/${name}`;
      found.set(path, child.mtime);
      if (fs.isDir(child.mode)) {
        if (!isDirectoryContents(child.contents)) return false;
        pending.push([child, path]);
      }
    }
  }
  for (const [path, mtime] of found) into.set(path, mtime);
  return true;
}

function isDirectoryContents(contents: unknown): boolean {
  return typeof contents === 'object' && contents !== null && !ArrayBuffer.isView(contents);
}

/**
 * Path → mtime for everything under the IDBFS mounts. IDBFS writes a path when it
 * is new or its mtime differs from the stored one, and deletes paths that are
 * gone, so an unchanged map means a flush would write nothing.
 */
function idbfsSnapshot(fs: EmscriptenFs): Map<string, number> {
  const snapshot = new Map<string, number>();
  for (const mount of fs.getMounts(fs.root.mount)) {
    if (mount.type !== fs.filesystems.IDBFS) continue;
    if (walkNodes(fs, mount, snapshot)) continue;
    const pending = [mount.mountpoint];
    for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
      for (const name of fs.readdir(dir)) {
        if (name === '.' || name === '..') continue;
        const path = `${dir}/${name}`;
        const stat = fs.stat(path);
        snapshot.set(path, Number(stat.mtime));
        if (fs.isDir(stat.mode)) pending.push(path);
      }
    }
  }
  return snapshot;
}

function sameSnapshot(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [path, mtime] of a) if (b.get(path) !== mtime) return false;
  return true;
}

/**
 * Skip a flush when nothing changed since the last successful one (#1160).
 *
 * PGlite flushes after every query, reads included. With nothing to write, IDBFS
 * still reads its whole file index back from IndexedDB to find that out: about
 * 35 ms a flush in Chromium and 730 ms in WebKitGTK, where it took 14.6 s of a
 * 21 s cold photo-grid load. Walking the in-memory filesystem is far cheaper.
 * The snapshot is taken in the same turn the flush reads its own, and is only
 * kept once that flush succeeds, so a failed flush is retried in full.
 */
export function skipCleanFlushes<T>(flush: Flush<T>): Flush<T> {
  const flushed = new WeakMap<object, Map<string, number>>();
  return async function (this: T, relaxedDurability?: boolean) {
    const fs = (this as { pg?: { Module?: { FS?: EmscriptenFs } } } | null)?.pg?.Module?.FS;
    if (!fs || typeof this !== 'object' || this === null) return flush.call(this, relaxedDurability);
    const snapshot = idbfsSnapshot(fs);
    const previous = flushed.get(this);
    if (previous && sameSnapshot(previous, snapshot)) return;
    await flush.call(this, relaxedDurability);
    flushed.set(this, snapshot);
  };
}
