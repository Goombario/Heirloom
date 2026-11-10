import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getOrCreateThumbnail, primeThumbnailCache } from '@/lib/media-thumbnail';
import { backfillMediaThumbnails, runBackfillMediaThumbnailsCli } from '@/scripts/backfill-media-thumbnails';

describe('hosted thumbnail priming', () => {
  let dataDir: string;
  const userId = 7001;
  const filename = 'synthetic-source.jpg';

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'media-thumbnail-prime-'));
    process.env.DATA_DIR = dataDir;
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    await rm(dataDir, { recursive: true, force: true });
  });

  async function syntheticJpeg(): Promise<Buffer> {
    return sharp(Buffer.alloc(512 * 384 * 3, 128), {
      raw: { width: 512, height: 384, channels: 3 },
    }).jpeg({ quality: 90 }).toBuffer();
  }

  it('creates 256px cache that the serving path consumes without reading the original', async () => {
    const original = await syntheticJpeg();
    const mediaDir = path.join(dataDir, 'uploads', String(userId), 'media');
    const originalPath = path.join(mediaDir, filename);
    await (await import('node:fs/promises')).mkdir(mediaDir, { recursive: true });
    await (await import('node:fs/promises')).writeFile(originalPath, original);

    await expect(primeThumbnailCache({
      original, userId, filename, size: 256, contentType: 'image/jpeg',
    })).resolves.toBe('created');

    const backupPath = `${originalPath}.backup`;
    await rename(originalPath, backupPath);
    const served = await getOrCreateThumbnail({
      originalPath, userId, filename, size: 256, contentType: 'image/jpeg',
    });

    expect(served.contentType).toBe('image/jpeg');
    expect(served.buffer.length).toBeGreaterThan(0);
    const key = createHash('sha256').update(filename, 'utf8').digest('hex');
    await expect(stat(path.join(mediaDir, '.thumbs', `${key}_256.jpg`))).resolves.toBeDefined();
  });

  it('reports exists on an idempotent second prime', async () => {
    const original = await syntheticJpeg();
    const first = await primeThumbnailCache({
      original, userId, filename, size: 256, contentType: 'image/jpeg',
    });
    const second = await primeThumbnailCache({
      original, userId, filename, size: 256, contentType: 'image/jpeg',
    });

    expect(first).toBe('created');
    expect(second).toBe('exists');
  });

  it('retires an exact legacy stem cache before publishing its hashed cache', async () => {
    const original = await syntheticJpeg();
    const thumbsDir = path.join(dataDir, 'uploads', String(userId), 'media', '.thumbs');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(thumbsDir, { recursive: true, mode: 0o700 });
    const legacyPath = path.join(thumbsDir, 'synthetic-source_256.jpg');
    await writeFile(legacyPath, Buffer.from('legacy cache'));

    await expect(primeThumbnailCache({
      original, userId, filename, size: 256, contentType: 'image/jpeg',
    })).resolves.toBe('created');
    await expect(stat(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('repairs a demonstrably invalid regular hashed cache entry', async () => {
    const original = await syntheticJpeg();
    const thumbsDir = path.join(dataDir, 'uploads', String(userId), 'media', '.thumbs');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(thumbsDir, { recursive: true, mode: 0o700 });
    const key = createHash('sha256').update(filename, 'utf8').digest('hex');
    const hashedPath = path.join(thumbsDir, `${key}_256.jpg`);
    await writeFile(hashedPath, Buffer.from('not a jpeg'));

    await expect(primeThumbnailCache({
      original, userId, filename, size: 256, contentType: 'image/jpeg',
    })).resolves.toBe('created');
    const repaired = await (await import('node:fs/promises')).readFile(hashedPath);
    expect(repaired.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it('passes through a raster that is already no wider than the requested size', async () => {
    const original = await sharp(Buffer.alloc(128 * 96 * 3, 128), {
      raw: { width: 128, height: 96, channels: 3 },
    }).jpeg({ quality: 90 }).toBuffer();

    await expect(primeThumbnailCache({
      original, userId, filename, size: 256, contentType: 'image/jpeg',
    })).resolves.toBe('passthrough');
    await expect(readdir(path.join(dataDir, 'uploads'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resizes a portrait whose width fits but whose height exceeds the requested size', async () => {
    const original = await sharp(Buffer.alloc(128 * 4000 * 3, 128), {
      raw: { width: 128, height: 4000, channels: 3 },
    }).jpeg({ quality: 90 }).toBuffer();

    await expect(primeThumbnailCache({
      original, userId, filename, size: 256, contentType: 'image/jpeg',
    })).resolves.toBe('created');

    const key = createHash('sha256').update(filename, 'utf8').digest('hex');
    const cached = await sharp(await (await import('node:fs/promises')).readFile(
      path.join(dataDir, 'uploads', String(userId), 'media', '.thumbs', `${key}_256.jpg`),
    )).metadata();
    expect(Math.max(cached.width ?? 0, cached.height ?? 0)).toBeLessThanOrEqual(256);
  });

  it('resizes a serving-path portrait whose width fits but whose height exceeds the requested size', async () => {
    const original = await sharp(Buffer.alloc(128 * 4000 * 3, 128), {
      raw: { width: 128, height: 4000, channels: 3 },
    }).jpeg({ quality: 90 }).toBuffer();
    const mediaDir = path.join(dataDir, 'uploads', String(userId), 'media');
    const originalPath = path.join(mediaDir, filename);
    await (await import('node:fs/promises')).mkdir(mediaDir, { recursive: true });
    await (await import('node:fs/promises')).writeFile(originalPath, original);

    const served = await getOrCreateThumbnail({
      originalPath, userId, filename, size: 256, contentType: 'image/jpeg',
    });
    const dimensions = await sharp(served.buffer).metadata();
    expect(Math.max(dimensions.width ?? 0, dimensions.height ?? 0)).toBeLessThanOrEqual(256);
  });

  it('rejects a non-basename before deriving a cache key', async () => {
    await expect(primeThumbnailCache({
      original: Buffer.from('synthetic'), userId, filename: 'nested/photo.jpg', size: 256, contentType: 'image/jpeg',
    })).rejects.toThrow('Invalid media filename');
  });

  it.each([
    ['image/svg+xml', '<svg/>'],
    ['image/gif', 'GIF89a'],
    ['application/octet-stream', 'not an image'],
  ])('passes through %s without creating a cache', async (contentType, contents) => {
    await expect(primeThumbnailCache({
      original: Buffer.from(contents), userId, filename, size: 256, contentType,
    })).resolves.toBe('passthrough');
    await expect(readdir(path.join(dataDir, 'uploads'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('allows only one concurrent prime to create the target and leaves no temp residue', async () => {
    const original = await syntheticJpeg();
    const results = await Promise.all(Array.from({ length: 8 }, () => primeThumbnailCache({
      original, userId, filename, size: 256, contentType: 'image/jpeg',
    })));

    expect(results.filter((result) => result === 'created')).toHaveLength(1);
    expect(results.filter((result) => result === 'exists')).toHaveLength(7);
    const entries = await readdir(path.join(dataDir, 'uploads', String(userId), 'media', '.thumbs'));
    const key = createHash('sha256').update(filename, 'utf8').digest('hex');
    expect(entries).toEqual([`${key}_256.jpg`]);
  });
});

describe('hosted thumbnail backfill', () => {
  const syntheticDataDir = path.resolve('synthetic-data');
  const rows = (filePaths: Array<string | null>) => filePaths.map((FilePath, index) => ({
    Id: index + 1, UserId: 7001, FilePath, ContentType: 'image/jpeg',
  }));
  const regularPathDeps = {
    lstat: async () => ({ isSymbolicLink: () => false, isFile: () => true, size: 10, dev: 1, ino: 1 }),
    realpath: async (value: string) => value,
  };

  it('returns empty aggregate counts without doing work when no rows need backfill', async () => {
    const read = async () => Buffer.from('synthetic');
    const prime = async () => 'created' as const;

    await expect(backfillMediaThumbnails({
      listRows: async () => [], readFile: read, primeThumbnailCache: prime,
    })).resolves.toEqual({ scanned: 0, created: 0, skipped: 0, failed: 0 });
  });

  it('reads an owner-contained basename and counts a newly created cache', async () => {
    const readFile = vi.fn().mockResolvedValue(Buffer.from('synthetic'));
    const prime = vi.fn().mockResolvedValue('created');

    await expect(backfillMediaThumbnails({
      ...regularPathDeps, listRows: async () => rows(['photo.jpg']),
      readFile,
      primeThumbnailCache: prime,
      getDataDir: () => syntheticDataDir,
    })).resolves.toEqual({ scanned: 1, created: 1, skipped: 0, failed: 0 });

    expect(readFile).toHaveBeenCalledWith(path.join(syntheticDataDir, 'uploads', '7001', 'media', 'photo.jpg'));
    expect(prime).toHaveBeenCalledWith(expect.objectContaining({ userId: 7001, filename: 'photo.jpg', size: 256 }));
  });

  it.each(['exists', 'passthrough'] as const)('counts %s cache outcomes as skipped', async (outcome) => {
    await expect(backfillMediaThumbnails({
      ...regularPathDeps, listRows: async () => rows(['photo.jpg']),
      readFile: async () => Buffer.from('synthetic'),
      primeThumbnailCache: async () => outcome,
    })).resolves.toEqual({ scanned: 1, created: 0, skipped: 1, failed: 0 });
  });

  it('rejects a non-basename path without attempting a read', async () => {
    const readFile = vi.fn();

    await expect(backfillMediaThumbnails({
      ...regularPathDeps, listRows: async () => rows(['nested/photo.jpg']),
      readFile,
      primeThumbnailCache: async () => 'created',
    })).resolves.toEqual({ scanned: 1, created: 0, skipped: 0, failed: 1 });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('rejects a symlinked original before reading it', async () => {
    const readFile = vi.fn();
    const lstat = vi.fn().mockResolvedValue({ isSymbolicLink: () => true, isFile: () => false, size: 10, dev: 1, ino: 1 });
    const realpath = vi.fn().mockImplementation(async (value: string) => value);
    const deps = {
      listRows: async () => rows(['photo.jpg']), readFile,
      primeThumbnailCache: async () => 'created' as const,
      getDataDir: () => syntheticDataDir, lstat, realpath,
    };

    await expect(backfillMediaThumbnails(deps)).resolves.toEqual({
      scanned: 1, created: 0, skipped: 0, failed: 1,
    });
    expect(lstat).toHaveBeenCalledOnce();
    expect(realpath).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('rejects a non-regular original before reading it', async () => {
    const readFile = vi.fn();
    const lstat = vi.fn().mockResolvedValue({ isSymbolicLink: () => false, isFile: () => false, size: 10, dev: 1, ino: 1 });
    const realpath = vi.fn();
    const deps = {
      listRows: async () => rows(['photo.jpg']), readFile,
      primeThumbnailCache: async () => 'created' as const,
      getDataDir: () => syntheticDataDir, lstat, realpath,
    };

    await expect(backfillMediaThumbnails(deps)).resolves.toEqual({
      scanned: 1, created: 0, skipped: 0, failed: 1,
    });
    expect(lstat).toHaveBeenCalledOnce();
    expect(realpath).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('rejects an original whose resolved parent escapes the resolved media directory', async () => {
    const readFile = vi.fn();
    const lstat = vi.fn().mockResolvedValue({ isSymbolicLink: () => false, isFile: () => true, size: 10, dev: 1, ino: 1 });
    const realpath = vi.fn()
      .mockResolvedValueOnce(path.join(syntheticDataDir, 'uploads', '7001', 'media'))
      .mockResolvedValueOnce(path.join(syntheticDataDir, 'outside', 'photo.jpg'));
    const deps = {
      listRows: async () => rows(['photo.jpg']), readFile,
      primeThumbnailCache: async () => 'created' as const,
      getDataDir: () => syntheticDataDir, lstat, realpath,
    };

    await expect(backfillMediaThumbnails(deps)).resolves.toEqual({
      scanned: 1, created: 0, skipped: 0, failed: 1,
    });
    expect(realpath).toHaveBeenCalledTimes(2);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('continues after missing files and prime failures while keeping aggregate counts', async () => {
    const readFile = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
      .mockResolvedValueOnce(Buffer.from('synthetic'))
      .mockResolvedValueOnce(Buffer.from('synthetic'));
    const prime = vi.fn()
      .mockResolvedValueOnce('created')
      .mockRejectedValueOnce(new Error('synthetic prime failure'));

    await expect(backfillMediaThumbnails({
      ...regularPathDeps, listRows: async () => rows(['missing.jpg', 'created.jpg', 'failed.jpg']),
      readFile,
      primeThumbnailCache: prime,
    })).resolves.toEqual({ scanned: 3, created: 1, skipped: 0, failed: 2 });
  });

  it('is safe to run twice, with the second pass counting existing cache files as skipped', async () => {
    const prime = vi.fn()
      .mockResolvedValueOnce('created')
      .mockResolvedValueOnce('exists');
    const deps = {
      ...regularPathDeps,
      listRows: async () => rows(['photo.jpg']),
      readFile: async () => Buffer.from('synthetic'),
      primeThumbnailCache: prime,
    };

    await expect(backfillMediaThumbnails(deps)).resolves.toEqual({ scanned: 1, created: 1, skipped: 0, failed: 0 });
    await expect(backfillMediaThumbnails(deps)).resolves.toEqual({ scanned: 1, created: 0, skipped: 1, failed: 0 });
  });

  it('cursor-paginates in stable ID order with bounded pages', async () => {
    const calls: Array<[number, number]> = [];
    const pageRows = [
      Array.from({ length: 100 }, (_, index) => ({
        Id: index + 1, UserId: 7001, FilePath: `photo-${index + 1}.jpg`, ContentType: 'image/jpeg',
      })),
      [{ Id: 108, UserId: 7001, FilePath: 'eighth.jpg', ContentType: 'image/jpeg' }],
      [],
    ];
    let page = 0;
    await expect(backfillMediaThumbnails({
      ...regularPathDeps,
      listRows: async (afterId, limit) => {
        calls.push([afterId, limit]);
        return pageRows[page++];
      },
      readFile: async () => Buffer.from('synthetic'),
      primeThumbnailCache: async () => 'created',
    })).resolves.toEqual({ scanned: 101, created: 101, skipped: 0, failed: 0 });
    expect(calls).toEqual([[0, 100], [100, 100]]);
  });

  it('advances the cursor across a full page of invalid rows', async () => {
    const calls: Array<[number, number]> = [];
    const invalidPage = Array.from({ length: 100 }, (_, index) => ({
      Id: index + 1, UserId: 7001, FilePath: null, ContentType: null,
    }));
    await expect(backfillMediaThumbnails({
      listRows: async (afterId, limit) => {
        calls.push([afterId, limit]);
        return calls.length === 1 ? invalidPage : [];
      },
      readFile: async () => Buffer.from('unreachable'),
      primeThumbnailCache: async () => 'created',
    })).resolves.toEqual({ scanned: 100, created: 0, skipped: 0, failed: 100 });
    expect(calls).toEqual([[0, 100], [100, 100]]);
  });

  it('preserves prior counts and increments failed when a later page query fails', async () => {
    const firstPage = rows(Array.from({ length: 100 }, (_, index) => `photo-${index}.jpg`));
    await expect(backfillMediaThumbnails({
      ...regularPathDeps,
      listRows: async (afterId) => {
        if (afterId === 0) return firstPage;
        throw new Error('later page unavailable');
      },
      readFile: async () => Buffer.from('synthetic'),
      primeThumbnailCache: async () => 'created',
    })).resolves.toEqual({ scanned: 100, created: 100, skipped: 0, failed: 1 });
  });

  it('rejects originals over 10 MiB before reading', async () => {
    const readFile = vi.fn();
    const deps = {
      listRows: async () => rows(['large.jpg']),
      lstat: async () => ({ isSymbolicLink: () => false, isFile: () => true, size: 10 * 1024 * 1024 + 1, dev: 1, ino: 1 }),
      realpath: async (value: string) => value,
      readFile,
      primeThumbnailCache: async () => 'created' as const,
    };
    await expect(backfillMediaThumbnails(deps)).resolves.toEqual({
      scanned: 1, created: 0, skipped: 0, failed: 1,
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('converts an initial query failure to one stable CLI failure and closes the pool', async () => {
    const closePool = vi.fn().mockResolvedValue(undefined);
    await expect(runBackfillMediaThumbnailsCli({
      run: async () => { throw new Error('database details'); },
      closePool,
    })).resolves.toEqual({ scanned: 0, created: 0, skipped: 0, failed: 1 });
    expect(closePool).toHaveBeenCalledOnce();
  });

  it('reports a failed CLI cleanup without exposing cleanup errors', async () => {
    const closePool = vi.fn().mockRejectedValue(new Error('pool details'));
    await expect(runBackfillMediaThumbnailsCli({
      run: async () => ({ scanned: 1, created: 1, skipped: 0, failed: 0 }),
      closePool,
    })).resolves.toEqual({ scanned: 1, created: 1, skipped: 0, failed: 0 });
    expect(closePool).toHaveBeenCalledOnce();
  });
});
