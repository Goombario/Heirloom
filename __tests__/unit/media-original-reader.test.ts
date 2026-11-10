import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat as actualLstat, mkdir, mkdtemp, readFile as actualReadFile, realpath as actualRealpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'os';
import path from 'path';

const mockedOpen = vi.hoisted(() => vi.fn());
vi.mock('fs/promises', async () => ({
  ...(await vi.importActual<typeof import('fs/promises')>('fs/promises')),
  open: mockedOpen,
}));

import { readHostedOriginal } from '@/lib/media-original';

describe('hosted original reader', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  beforeEach(() => {
    mockedOpen.mockImplementation(async (target: string) => {
      let offset = 0;
      return {
        stat: () => actualLstat(target),
        readFile: () => actualReadFile(target),
        read: async (buffer: Buffer) => {
          const contents = await actualReadFile(target);
          if (offset >= contents.length) return { bytesRead: 0, buffer };
          const bytesRead = Math.min(buffer.length, contents.length - offset);
          contents.copy(buffer, 0, offset, offset + bytesRead);
          offset += bytesRead;
          return { bytesRead, buffer };
        },
        close: async () => undefined,
      };
    });
  });

  async function makeMediaDir() {
    root = await mkdtemp(path.join(os.tmpdir(), 'hosted-original-reader-'));
    const mediaDir = path.join(root, 'media');
    await mkdir(mediaDir);
    return mediaDir;
  }

  it('reads a regular hosted original', async () => {
    const mediaDir = await makeMediaDir();
    await writeFile(path.join(mediaDir, 'portrait.jpg'), Buffer.from('regular-original'));

    await expect(readHostedOriginal({ mediaDir, filename: 'portrait.jpg' }))
      .resolves.toEqual(Buffer.from('regular-original'));
  });

  it('rejects a final symlink instead of following it', async () => {
    const mediaDir = await makeMediaDir();
    const outside = path.join(root!, 'outside.jpg');
    await writeFile(outside, Buffer.from('outside'));
    try {
      await symlink(outside, path.join(mediaDir, 'portrait.jpg'));
    } catch (error) {
      // Creating symlinks requires elevated privileges on many Windows hosts;
      // identity checks are covered by the race test on that platform.
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    await expect(readHostedOriginal({ mediaDir, filename: 'portrait.jpg' })).rejects.toThrow();
  });

  it('rejects when the media directory identity changes while reading', async () => {
    const mediaDir = await makeMediaDir();
    const originalPath = path.join(mediaDir, 'portrait.jpg');
    await writeFile(originalPath, Buffer.from('regular-original'));
    const initialDirectory = await actualLstat(mediaDir);
    const changedDirectory = new Proxy(initialDirectory, {
      get(target, property, receiver) {
        if (property === 'ino') return target.ino + 1;
        if (property === 'dev') return target.dev + 1;
        return Reflect.get(target, property, receiver);
      },
    });
    let directoryChecks = 0;
    let readCompleted = false;
    let readOnce = false;
    const handle = {
      stat: vi.fn(async () => actualLstat(originalPath)),
      readFile: vi.fn(async () => {
        readCompleted = true;
        return Buffer.from('regular-original');
      }),
      read: vi.fn(async (buffer: Buffer) => {
        readCompleted = true;
        const contents = Buffer.from('regular-original');
        if (readOnce) return { bytesRead: 0, buffer };
        readOnce = true;
        contents.copy(buffer);
        return { bytesRead: contents.length, buffer };
      }),
      close: vi.fn(async () => undefined),
    };
    mockedOpen.mockResolvedValue(handle);

    const lstatWithDeterministicParentChange = async (target: string) => {
      if (target === mediaDir) {
        directoryChecks += 1;
        return directoryChecks === 1 ? initialDirectory : (directoryChecks === 2 ? initialDirectory : changedDirectory);
      }
      return actualLstat(target);
    };

    const readPromise = readHostedOriginal({
      mediaDir,
      filename: 'portrait.jpg',
      fs: { lstat: lstatWithDeterministicParentChange, realpath: actualRealpath, open: mockedOpen },
    });
    await expect(readPromise).rejects.toThrow('Media directory changed');
    expect(readCompleted).toBe(true);
    expect(directoryChecks).toBe(3);
  });

  it('reads through a symlinked ancestor while retaining the canonical parent confinement', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'hosted-original-symlink-'));
    const physicalParent = path.join(root, 'physical');
    const physicalMediaDir = path.join(physicalParent, 'media');
    const linkedParent = path.join(root, 'linked');
    await mkdir(physicalMediaDir, { recursive: true });
    await writeFile(path.join(physicalMediaDir, 'portrait.jpg'), Buffer.from('symlinked-ancestor'));
    try {
      await symlink(physicalParent, linkedParent, 'junction');
    } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    await expect(readHostedOriginal({
      mediaDir: path.join(linkedParent, 'media'),
      filename: 'portrait.jpg',
    })).resolves.toEqual(Buffer.from('symlinked-ancestor'));
  });

  it('bounds handle reads to maxBytes plus one byte when the file grows after pre-stat', async () => {
    const mediaDir = await makeMediaDir();
    const originalPath = path.join(mediaDir, 'portrait.jpg');
    await writeFile(originalPath, Buffer.from('small'));
    const maxBytes = 32;
    const readRequests: number[] = [];
    const handle = {
      stat: vi.fn(async () => actualLstat(originalPath)),
      readFile: vi.fn(async () => Buffer.alloc(maxBytes + 1, 7)),
      read: vi.fn(async (buffer: Buffer) => {
        readRequests.push(buffer.byteLength);
        buffer.fill(7);
        return { bytesRead: buffer.byteLength, buffer };
      }),
      close: vi.fn(async () => undefined),
    };
    mockedOpen.mockResolvedValue(handle);

    await expect(readHostedOriginal({ mediaDir, filename: 'portrait.jpg', maxBytes }))
      .rejects.toThrow('Original too large');
    expect(readRequests).toEqual([maxBytes + 1]);
    expect(readRequests.every((requested) => requested <= maxBytes + 1)).toBe(true);
    expect(handle.readFile).not.toHaveBeenCalled();
  });
});
