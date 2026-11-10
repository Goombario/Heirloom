import { constants } from 'fs';
import type { Stats } from 'fs';
import { lstat, open, realpath } from 'fs/promises';
import path from 'path';

export const MAX_HOSTED_ORIGINAL_BYTES = 10 * 1024 * 1024;

type FileIdentity = { dev: number; ino: number };
type DirectoryIdentity = FileIdentity & { resolved: string };
type ReaderFs = {
  lstat: (path: string) => Promise<Stats>;
  open: (path: string, flags: number) => ReturnType<typeof open>;
  realpath: (path: string) => Promise<string>;
};

function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function assertBasename(filename: string): void {
  if (!filename || path.basename(filename) !== filename || filename === '.' || filename === '..') {
    throw new Error('Invalid media filename');
  }
}

async function captureMediaDirectory(mediaDir: string, fs: ReaderFs): Promise<DirectoryIdentity> {
  const stats = await fs.lstat(mediaDir);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Invalid media directory');
  const resolved = await fs.realpath(mediaDir);
  return { dev: stats.dev, ino: stats.ino, resolved };
}

async function assertMediaDirectoryUnchanged(
  mediaDir: string,
  expected: DirectoryIdentity,
  fs: ReaderFs,
): Promise<void> {
  const current = await captureMediaDirectory(mediaDir, fs);
  if (!sameFile(expected, current) || current.resolved !== expected.resolved) {
    throw new Error('Media directory changed');
  }
}

async function readBounded(
  handle: Awaited<ReturnType<typeof open>>,
  maxBytes: number,
): Promise<Buffer<ArrayBuffer>> {
  const chunks: Buffer<ArrayBuffer>[] = [];
  let total = 0;
  const chunkSize = Math.min(64 * 1024, maxBytes + 1);

  while (total < maxBytes + 1) {
    const buffer = Buffer.allocUnsafe(Math.min(chunkSize, maxBytes + 1 - total));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    const chunk = buffer.subarray(0, bytesRead) as Buffer<ArrayBuffer>;
    chunks.push(chunk);
    total += bytesRead;
    if (total > maxBytes) throw new Error('Original too large');
  }

  return Buffer.concat(chunks, total) as Buffer<ArrayBuffer>;
}

/**
 * Read one hosted original while pinning both the parent directory and the
 * opened final entry. This is deliberately handle-based: pathname checks alone
 * are not sufficient against replacement races.
 */
export async function readHostedOriginal(args: {
  mediaDir: string;
  filename: string;
  maxBytes?: number;
  fs?: Partial<ReaderFs>;
}): Promise<Buffer<ArrayBuffer>> {
  const { mediaDir, filename, maxBytes = MAX_HOSTED_ORIGINAL_BYTES } = args;
  const fs: ReaderFs = { lstat, open, realpath, ...args.fs };
  assertBasename(filename);
  const directory = await captureMediaDirectory(mediaDir, fs);
  const originalPath = path.resolve(directory.resolved, filename);
  if (path.dirname(originalPath) !== path.resolve(directory.resolved)
    || path.basename(originalPath) !== filename) {
    throw new Error('Original outside media directory');
  }

  const before = await fs.lstat(originalPath);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('Invalid original entry');
  if (before.size > maxBytes) throw new Error('Original too large');

  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const handle = await fs.open(originalPath, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat() as Stats;
    if (opened.isSymbolicLink() || !opened.isFile() || !sameFile(before, opened)) {
      throw new Error('Original changed');
    }
    await assertMediaDirectoryUnchanged(mediaDir, directory, fs);
    const bytes = await readBounded(handle, maxBytes);
    const after = await handle.stat() as Stats;
    if (!after.isFile() || !sameFile(opened, after)) throw new Error('Original changed');
    await assertMediaDirectoryUnchanged(mediaDir, directory, fs);
    return bytes;
  } finally {
    await handle.close();
  }
}
