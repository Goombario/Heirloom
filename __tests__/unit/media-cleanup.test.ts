import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const fsMocks = vi.hoisted(() => ({
  unlink: vi.fn(),
  readdir: vi.fn(),
  lstat: vi.fn(),
  realpath: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  readdir: fsMocks.readdir,
  lstat: fsMocks.lstat,
  realpath: fsMocks.realpath,
  unlink: fsMocks.unlink,
}));

vi.mock('@/lib/data-dir', () => ({
  getDataDir: () => '/data',
}));

import { cleanupMediaFiles, cleanupMediaFilesCounting } from '@/lib/media-thumbnail';

describe('cleanupMediaFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.unlink.mockResolvedValue(undefined);
    fsMocks.readdir.mockResolvedValue([]);
    fsMocks.lstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isDirectory: () => true,
      isFile: () => true,
      mode: 0o700,
      dev: 1,
      ino: 1,
    });
    fsMocks.realpath.mockImplementation(async (value: string) => value);
  });

  it('returns null when the original and thumbnail directory are missing', async () => {
    fsMocks.unlink.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    fsMocks.readdir.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    await expect(cleanupMediaFiles(7, 'photo.jpg')).resolves.toBeNull();
  });

  it('returns a cleanup warning for a non-ENOENT original failure', async () => {
    fsMocks.unlink.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

    await expect(cleanupMediaFiles(7, 'photo.jpg')).resolves.toBe('storage_cleanup_failed');
    expect(fsMocks.readdir).toHaveBeenCalled();
  });

  it('returns a cleanup warning when thumbnail enumeration fails', async () => {
    fsMocks.readdir.mockRejectedValueOnce(Object.assign(new Error('io failure'), { code: 'EIO' }));

    await expect(cleanupMediaFiles(7, 'photo.jpg')).resolves.toBe('storage_cleanup_failed');
  });

  it('returns a cleanup warning when any thumbnail unlink fails and logs every non-ENOENT failure', async () => {
    fsMocks.readdir.mockResolvedValueOnce(['photo_160.jpg', 'photo_320.jpg', 'other_160.jpg']);
    fsMocks.unlink
      .mockRejectedValueOnce(Object.assign(new Error('original failure'), { code: 'EIO' }))
      .mockRejectedValueOnce(Object.assign(new Error('thumbnail failure'), { code: 'EACCES' }))
      .mockResolvedValueOnce(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(cleanupMediaFiles(7, 'photo.jpg')).resolves.toBe('storage_cleanup_failed');

    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(fsMocks.unlink).toHaveBeenCalledTimes(3);
    errorSpy.mockRestore();
  });

  it('swallows ENOENT for individual thumbnails while cleaning the rest', async () => {
    fsMocks.readdir.mockResolvedValueOnce(['photo_160.jpg', 'photo_320.jpg']);
    fsMocks.unlink
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    await expect(cleanupMediaFiles(7, 'photo.jpg')).resolves.toBeNull();
  });

  it('removes the collision-resistant cache key and compatible legacy entries', async () => {
    const key = createHash('sha256').update('photo.jpg', 'utf8').digest('hex');
    fsMocks.readdir.mockResolvedValueOnce([
      `${key}_256.jpg`, 'photo_256.jpg', 'photo-other_256.jpg',
    ]);

    await expect(cleanupMediaFiles(7, 'photo.jpg')).resolves.toBeNull();

    expect(fsMocks.unlink).toHaveBeenCalledTimes(3);
  });

  it('fails closed without unlinking when the cache parent changes identity', async () => {
    fsMocks.readdir.mockResolvedValueOnce(['photo_256.jpg']);
    fsMocks.lstat
      .mockResolvedValueOnce({
        isSymbolicLink: () => false, isDirectory: () => true, isFile: () => true,
        mode: 0o700, dev: 1, ino: 1,
      })
      .mockResolvedValueOnce({
        isSymbolicLink: () => false, isDirectory: () => true, isFile: () => true,
        mode: 0o700, dev: 9, ino: 9,
      });

    await expect(cleanupMediaFiles(7, 'photo.jpg')).resolves.toBe('storage_cleanup_failed');
    expect(fsMocks.unlink).toHaveBeenCalledTimes(1);
  });
});

describe('cleanupMediaFilesCounting (#945)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.unlink.mockResolvedValue(undefined);
    fsMocks.readdir.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    fsMocks.lstat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    fsMocks.realpath.mockImplementation(async (value: string) => value);
  });

  it('counts 0 when every file is removed', async () => {
    await expect(cleanupMediaFilesCounting(7, ['a.jpg', 'b.jpg'])).resolves.toBe(0);
  });

  it('counts a failed unlink and a throw, and keeps going', async () => {
    fsMocks.unlink.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A non-string path makes cleanupMediaFiles throw before any unlink.
    const files = ['a.jpg', undefined as unknown as string, 'c.jpg'];
    await expect(cleanupMediaFilesCounting(7, files)).resolves.toBe(2);
    expect(fsMocks.unlink).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
