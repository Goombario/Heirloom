import { describe, expect, it, vi } from 'vitest';
import { retryFlushOnEnoent, serializeFlushes, skipCleanFlushes } from '@/lib/db/idbfs-flush-retry';

const enoent = Object.assign(new Error('ErrnoError'), { name: 'ErrnoError', errno: 44 });

describe('retryFlushOnEnoent (#713)', () => {
  it('retries a flush that lost a file mid-walk, keeping `this` and the argument', async () => {
    const target = {};
    const flush = vi.fn<(this: object, relaxed?: boolean) => Promise<void>>()
      .mockRejectedValueOnce(enoent)
      .mockResolvedValueOnce();
    await expect(retryFlushOnEnoent(flush).call(target, true)).resolves.toBeUndefined();
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush.mock.contexts[1]).toBe(target);
    expect(flush).toHaveBeenLastCalledWith(true);
  });

  it('gives up after three ENOENT attempts', async () => {
    const flush = vi.fn<() => Promise<void>>().mockRejectedValue(enoent);
    await expect(retryFlushOnEnoent(flush).call(undefined)).rejects.toBe(enoent);
    expect(flush).toHaveBeenCalledTimes(3);
  });

  it('does not retry other errors', async () => {
    const other = Object.assign(new Error('closing'), { name: 'InvalidStateError' });
    const flush = vi.fn<() => Promise<void>>().mockRejectedValue(other);
    await expect(retryFlushOnEnoent(flush).call(undefined)).rejects.toBe(other);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe('serializeFlushes (#1008)', () => {
  it('runs flushes one at a time, in order, and a failure does not block the next', async () => {
    const log: string[] = [];
    const gates: Array<() => void> = [];
    const flush = vi.fn(function (this: unknown) {
      const n = flush.mock.calls.length;
      log.push(`start ${n}`);
      return new Promise<void>((resolve, reject) => {
        gates.push(() => { log.push(`end ${n}`); if (n === 1) reject(new Error('quota')); else resolve(); });
      });
    });
    const serial = serializeFlushes(flush);
    const first = serial.call(null);
    const second = serial.call(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(['start 1']);
    gates[0]();
    await expect(first).rejects.toThrow('quota');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).toEqual(['start 1', 'end 1', 'start 2']);
    gates[1]();
    await second;
    expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });
});

/** A minimal Emscripten FS: one IDBFS mount at /pglite/db holding `files` (path → mtime). */
function fakeIdbfsTarget(files: Map<string, number>) {
  const IDBFS = { name: 'IDBFS' };
  const root = { type: { name: 'MEMFS' }, mountpoint: '/' };
  const idbMount = { type: IDBFS, mountpoint: '/pglite/db' };
  const DIR = 0o040000;
  const children = (dir: string) => [...new Set([...files.keys()]
    .filter((p) => p.startsWith(dir + '/'))
    .map((p) => p.slice(dir.length + 1).split('/')[0]))];
  const isDirPath = (p: string) => [...files.keys()].some((f) => f.startsWith(p + '/'));
  const FS = {
    root: { mount: root },
    filesystems: { IDBFS },
    getMounts: () => [root, idbMount, { type: { name: 'MEMFS' }, mountpoint: '/tmp' }],
    readdir: (dir: string) => ['.', '..', ...children(dir)],
    stat: (p: string) => (isDirPath(p) ? { mode: DIR, mtime: new Date(1) } : { mode: 0o100644, mtime: new Date(files.get(p)!) }),
    isDir: (mode: number) => (mode & DIR) === DIR,
  };
  return { pg: { Module: { FS } } };
}

describe('skipCleanFlushes (#1160)', () => {
  const setup = () => {
    const files = new Map([['/pglite/db/base/1/1259', 100], ['/pglite/db/global/pg_control', 100]]);
    const target = fakeIdbfsTarget(files);
    const flush = vi.fn<(this: object, relaxed?: boolean) => Promise<void>>().mockResolvedValue();
    return { files, target, flush, skip: skipCleanFlushes(flush) };
  };

  it('flushes the first time, then skips while nothing changed', async () => {
    const { target, flush, skip } = setup();
    await skip.call(target, true);
    await skip.call(target, true);
    await skip.call(target, false);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(true);
  });

  it.each([
    ['a file is rewritten', (f: Map<string, number>) => f.set('/pglite/db/base/1/1259', 101)],
    ['a file is created', (f: Map<string, number>) => f.set('/pglite/db/base/1/16384', 100)],
    ['a file is deleted', (f: Map<string, number>) => f.delete('/pglite/db/global/pg_control')],
  ])('flushes again when %s', async (_label, change) => {
    const { files, target, flush, skip } = setup();
    await skip.call(target);
    change(files);
    await skip.call(target);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('does not record a failed flush, so the next call flushes in full', async () => {
    const { target, flush, skip } = setup();
    flush.mockRejectedValueOnce(new Error('quota'));
    await expect(skip.call(target)).rejects.toThrow('quota');
    await skip.call(target);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('ignores files outside the IDBFS mount', async () => {
    const { files, target, flush, skip } = setup();
    await skip.call(target);
    files.set('/tmp/scratch', 500);
    // /tmp is a separate MEMFS mount that IDBFS never persists; walking it would see a change.
    await skip.call(target);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('passes through when there is no filesystem to inspect', async () => {
    const flush = vi.fn<() => Promise<void>>().mockResolvedValue();
    const skip = skipCleanFlushes(flush);
    await skip.call({});
    await skip.call({});
    expect(flush).toHaveBeenCalledTimes(2);
  });
});

/** The same mount as real Emscripten exposes it: MEMFS nodes under `mount.root`. */
function fakeNodeTarget() {
  const DIR = 0o040000;
  const LINK = 0o120000;
  const IDBFS = { name: 'IDBFS' };
  const file = (mtime: number) => ({ mode: 0o100644, mtime, contents: new Uint8Array(1) });
  const relmap = file(100);
  const base = { mode: DIR, mtime: 1, contents: { '1259': file(100) } as Record<string, unknown> };
  const root = { mode: DIR, mtime: 1, contents: { base, global: { mode: DIR, mtime: 1, contents: { relmap } } } as Record<string, unknown> };
  const idbMount = { type: IDBFS, mountpoint: '/pglite/db', root };
  const stat = vi.fn(() => { throw new Error('the node walk should not stat by path'); });
  const FS = {
    root: { mount: { type: { name: 'MEMFS' }, mountpoint: '/' } },
    filesystems: { IDBFS },
    getMounts: () => [idbMount],
    readdir: (): string[] => { throw new Error('the node walk should not readdir by path'); },
    stat,
    isDir: (mode: number) => (mode & 0o170000) === DIR,
    isLink: (mode: number) => (mode & 0o170000) === LINK,
  };
  return { target: { pg: { Module: { FS } } }, relmap, base, root, LINK, stat, FS };
}

describe('skipCleanFlushes node walk (#1277)', () => {
  it('reads mtimes from the nodes, without a path lookup per file', async () => {
    const { target, relmap, base, stat } = fakeNodeTarget();
    const flush = vi.fn<(this: object) => Promise<void>>().mockResolvedValue();
    const skip = skipCleanFlushes(flush);
    await skip.call(target);
    await skip.call(target);
    expect(flush).toHaveBeenCalledTimes(1);
    relmap.mtime = 200;
    await skip.call(target);
    base.contents['16384'] = { mode: 0o100644, mtime: 100, contents: new Uint8Array(1) };
    await skip.call(target);
    delete base.contents['1259'];
    await skip.call(target);
    expect(flush).toHaveBeenCalledTimes(4);
    expect(stat).not.toHaveBeenCalled();
  });

  it('falls back to walking by path when the mount holds a link', async () => {
    const { target, root, LINK, FS } = fakeNodeTarget();
    root.contents.link = { mode: LINK, mtime: 1 };
    const readdir = vi.fn(() => ['.', '..']);
    FS.readdir = readdir;
    const flush = vi.fn<(this: object) => Promise<void>>().mockResolvedValue();
    await skipCleanFlushes(flush).call(target);
    expect(readdir).toHaveBeenCalledWith('/pglite/db');
  });
});
