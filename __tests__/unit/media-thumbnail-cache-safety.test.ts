import { describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  lstat: vi.fn(),
  realpath: vi.fn(),
  open: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  lstat: fsMocks.lstat,
  realpath: fsMocks.realpath,
  open: fsMocks.open,
  readFile: fsMocks.readFile,
  mkdir: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
  link: vi.fn(),
}));

vi.mock('@/lib/data-dir', () => ({ getDataDir: () => 'C:\\synthetic-data' }));

import { getOrCreateThumbnail } from '@/lib/media-thumbnail';

describe('thumbnail cache pathname safety', () => {
  function directoryStats(mode: number, dev = 1, ino = 1) {
    return {
      isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false,
      mode, dev, ino,
    };
  }

  it('does not return cached bytes when the cache parent changes after the read', async () => {
    const directory = directoryStats(0o700);
    const target = {
      isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true,
      mode: 0o600, dev: 2, ino: 2,
    };
    fsMocks.lstat
      .mockResolvedValueOnce(directory)
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce({ ...directory, dev: 9, ino: 9 });
    fsMocks.realpath.mockResolvedValue('C:\\synthetic-data\\uploads\\7\\media\\.thumbs');
    const handle = {
      stat: vi.fn().mockResolvedValue(target),
      readFile: vi.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
      close: vi.fn().mockResolvedValue(undefined),
    };
    fsMocks.open.mockResolvedValue(handle);
    fsMocks.readFile.mockResolvedValue(Buffer.from('outside bytes'));

    await expect(getOrCreateThumbnail({
      originalPath: 'C:\\synthetic-data\\uploads\\7\\media\\photo.jpg',
      userId: 7,
      filename: 'photo.jpg',
      size: 256,
      contentType: 'image/jpeg',
    })).rejects.toThrow();
    expect(handle.readFile).toHaveBeenCalledOnce();
    expect(fsMocks.readFile).not.toHaveBeenCalled();
  });

  it.each([
    [0o755, true],
    [0o775, false],
    [0o777, false],
  ])('applies POSIX private-directory policy to mode %o', async (mode, accepted) => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const directory = directoryStats(mode);
    const target = {
      isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true,
      mode: 0o600, dev: 2, ino: 2,
    };
    fsMocks.lstat
      .mockResolvedValueOnce(directory)
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(directory);
    fsMocks.realpath.mockResolvedValue('C:\\synthetic-data\\uploads\\7\\media\\.thumbs');
    const handle = {
      stat: vi.fn().mockResolvedValue(target),
      readFile: vi.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
      close: vi.fn().mockResolvedValue(undefined),
    };
    fsMocks.open.mockResolvedValue(handle);

    try {
      const result = getOrCreateThumbnail({
        originalPath: 'C:\\synthetic-data\\uploads\\7\\media\\photo.jpg',
        userId: 7,
        filename: 'photo.jpg',
        size: 256,
        contentType: 'image/jpeg',
      });
      if (accepted) await expect(result).resolves.toMatchObject({ contentType: 'image/jpeg' });
      else await expect(result).rejects.toThrow('Invalid thumbnail cache directory');
    } finally {
      platform.mockRestore();
      vi.clearAllMocks();
    }
  });
});
