import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { primeThumbnailCache } from '@/lib/media-thumbnail';
import { isLiveThumbnail, parseSweepArgs, sweepOrphanMedia } from '@/scripts/sweep-orphan-media.mjs';

const OWNER = 7001;
const DAY_MS = 24 * 3_600_000;

function sha(filename: string): string {
  return createHash('sha256').update(filename, 'utf8').digest('hex');
}

describe('sweepOrphanMedia', () => {
  let dataDir: string;
  let mediaDir: string;
  let thumbsDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'sweep-orphan-media-'));
    mediaDir = path.join(dataDir, 'uploads', String(OWNER), 'media');
    thumbsDir = path.join(mediaDir, '.thumbs');
    await mkdir(thumbsDir, { recursive: true, mode: 0o700 });
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    await rm(dataDir, { recursive: true, force: true });
  });

  async function put(dir: string, name: string, ageMs = 2 * DAY_MS, bytes = 10): Promise<string> {
    const target = path.join(dir, name);
    await writeFile(target, Buffer.alloc(bytes, 1));
    const when = new Date(Date.now() - ageMs);
    await utimes(target, when, when);
    return target;
  }

  const sweep = (referenced: string[], extra: Partial<Parameters<typeof sweepOrphanMedia>[0]> = {}) =>
    sweepOrphanMedia({ dataDir, listReferencedFilePaths: async () => referenced, ...extra });

  async function seedMixedLayout() {
    await put(mediaDir, 'kept.jpg');
    await put(mediaDir, 'orphan.jpg', 2 * DAY_MS, 100);
    await put(mediaDir, 'fresh.jpg', 60_000);
    await put(thumbsDir, `${sha('kept.jpg')}_256.jpg`);
    await put(thumbsDir, 'kept_160.jpg');
    await put(thumbsDir, `${sha('orphan.jpg')}_256.jpg`, 2 * DAY_MS, 7);
    await put(thumbsDir, 'orphan_160.jpg', 2 * DAY_MS, 5);
  }

  it('dry run reports orphans, referenced and young files without deleting anything', async () => {
    await seedMixedLayout();

    const report = await sweep(['kept.jpg']);

    expect(report.mode).toBe('dry-run');
    expect(report.totals.originals).toEqual({ orphans: 1, orphanBytes: 100, referenced: 1, young: 1 });
    expect(report.totals.thumbnails).toEqual({ orphans: 2, orphanBytes: 12, referenced: 2, young: 0 });
    expect(report.files.map((file) => file.path).sort()).toEqual([
      path.join(String(OWNER), 'media', '.thumbs', `${sha('orphan.jpg')}_256.jpg`),
      path.join(String(OWNER), 'media', '.thumbs', 'orphan_160.jpg'),
      path.join(String(OWNER), 'media', 'orphan.jpg'),
    ].sort());
    expect(report.deleted).toEqual({ count: 0, bytes: 0 });
    expect(await readdir(mediaDir)).toHaveLength(4);
    expect(await readdir(thumbsDir)).toHaveLength(4);
  });

  it('apply deletes only old orphans and their thumbnails', async () => {
    await seedMixedLayout();

    const report = await sweep(['kept.jpg'], { apply: true });

    expect(report.deleted).toEqual({ count: 3, bytes: 112 });
    expect(report.failed).toBe(0);
    expect((await readdir(mediaDir)).sort()).toEqual(['.thumbs', 'fresh.jpg', 'kept.jpg']);
    expect((await readdir(thumbsDir)).sort()).toEqual([`${sha('kept.jpg')}_256.jpg`, 'kept_160.jpg'].sort());
  });

  it('matches references by basename, so a stored path with directories still protects its file', async () => {
    await put(mediaDir, 'photo.jpg');

    const report = await sweep(['nested/dir/photo.jpg', null as unknown as string], { apply: true });

    expect(report.totals.originals.referenced).toBe(1);
    expect(report.deleted.count).toBe(0);
  });

  it('never follows or removes symlinks, and skips symlinked media and owner directories', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'sweep-orphan-outside-'));
    try {
      const victim = await put(outside, 'victim.jpg');
      await symlink(victim, path.join(mediaDir, 'link.jpg'));
      await symlink(outside, path.join(mediaDir, 'linked-dir'));
      await mkdir(path.join(dataDir, 'uploads', '7002'), { recursive: true });
      await symlink(outside, path.join(dataDir, 'uploads', '7002', 'media'));
      await symlink(outside, path.join(dataDir, 'uploads', '7003'));

      const report = await sweep([], { apply: true });

      expect(report.deleted.count).toBe(0);
      expect(report.totals.skipped).toBe(4);
      expect(await readdir(outside)).toEqual(['victim.jpg']);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('skips a symlinked thumbnail directory', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'sweep-orphan-thumbs-'));
    try {
      await put(outside, 'stray_256.jpg');
      await rm(thumbsDir, { recursive: true });
      await symlink(outside, thumbsDir);

      const report = await sweep([], { apply: true });

      expect(report.totals.skipped).toBe(1);
      expect(await readdir(outside)).toEqual(['stray_256.jpg']);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('ignores directories under uploads that are not numeric owner ids', async () => {
    const other = path.join(dataDir, 'uploads', 'tmp');
    await mkdir(other);
    await put(other, 'stray.jpg');

    const report = await sweep([], { apply: true });

    expect(report.owners.map((owner) => owner.ownerId)).toEqual([OWNER]);
    expect(await readdir(other)).toEqual(['stray.jpg']);
  });

  it('re-reads references before deleting, so a row committed mid-sweep keeps its file', async () => {
    await put(mediaDir, 'late.jpg');
    const answers = [['other.jpg'], ['other.jpg', 'late.jpg']];

    const report = await sweepOrphanMedia({
      dataDir, apply: true, listReferencedFilePaths: async () => answers.shift() ?? [],
    });

    expect(report.totals.originals.orphans).toBe(1);
    expect(report.deleted.count).toBe(0);
    expect(await readdir(mediaDir)).toContain('late.jpg');
  });

  it('counts an unlink failure without stopping the rest of the sweep', async () => {
    await put(mediaDir, 'a.jpg');
    await put(mediaDir, 'b.jpg');
    let calls = 0;

    const report = await sweep(['other.jpg'], {
      apply: true,
      unlinkFile: async () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    });

    expect(report.failed).toBe(1);
    expect(report.deleted.count).toBe(1);
  });

  it('refuses to apply when no Media row references any file', async () => {
    await put(mediaDir, 'a.jpg');

    await expect(sweep([], { apply: true })).rejects.toThrow('refusing to apply');
    expect(await readdir(mediaDir)).toContain('a.jpg');
    await expect(sweep([])).resolves.toMatchObject({ totals: { originals: { orphans: 1 } } });
  });

  it('returns an empty report when there is no uploads directory', async () => {
    await rm(path.join(dataDir, 'uploads'), { recursive: true });

    const report = await sweep([]);

    expect(report.owners).toEqual([]);
  });

  it('rejects a grace period under one hour', async () => {
    await expect(sweep([], { graceHours: 0.5 })).rejects.toThrow('at least 1 hour');
  });

  it('treats thumbnails written by primeThumbnailCache as live for their file only', async () => {
    process.env.DATA_DIR = dataDir;
    const original = await sharp(Buffer.alloc(512 * 384 * 3, 128), {
      raw: { width: 512, height: 384, channels: 3 },
    }).jpeg().toBuffer();
    await primeThumbnailCache({ original, userId: OWNER, filename: 'live.jpg', size: 256, contentType: 'image/jpeg' });
    await primeThumbnailCache({ original, userId: OWNER, filename: 'gone.jpg', size: 256, contentType: 'image/jpeg' });
    const old = new Date(Date.now() - 2 * DAY_MS);
    for (const name of await readdir(thumbsDir)) await utimes(path.join(thumbsDir, name), old, old);

    const report = await sweep(['live.jpg'], { apply: true });

    expect(report.totals.thumbnails).toMatchObject({ referenced: 1, orphans: 1 });
    expect(await readdir(thumbsDir)).toEqual([`${sha('live.jpg')}_256.jpg`]);
  });
});

describe('isLiveThumbnail', () => {
  it('keeps a legacy name alive for every referenced stem it could belong to', () => {
    expect(isLiveThumbnail('a_b_256.jpg', new Set(['a_']))).toBe(true);
    expect(isLiveThumbnail('a_b_256.jpg', new Set(['a_b_']))).toBe(true);
    expect(isLiveThumbnail('ab_256.jpg', new Set(['a_']))).toBe(false);
    expect(isLiveThumbnail('nounderscore.jpg', new Set(['nounderscore.jpg']))).toBe(false);
  });
});

describe('parseSweepArgs', () => {
  it('defaults to a 24 hour dry run', () => {
    expect(parseSweepArgs([])).toEqual({ apply: false, list: false, graceHours: 24 });
  });

  it('parses apply, list and a grace period', () => {
    expect(parseSweepArgs(['--apply', '--list', '--grace-hours=48'])).toEqual({ apply: true, list: true, graceHours: 48 });
  });

  it('rejects unknown flags and a malformed grace period', () => {
    expect(() => parseSweepArgs(['--aply'])).toThrow('Unknown argument');
    expect(Number.isNaN(parseSweepArgs(['--grace-hours=abc']).graceHours)).toBe(true);
  });
});
