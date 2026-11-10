import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const referenced = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock('@/lib/db/queries/media', () => ({ listAllReferencedMediaFilePaths: async () => referenced.paths }));
const admin = vi.hoisted(() => ({ ok: true }));
vi.mock('@/lib/services/members', async () => {
  const { AccessError } = await import('@/lib/data/errors');
  return {
    requireAdmin: async () => { if (!admin.ok) throw new AccessError('Only an admin can manage members'); },
  };
});

import { getOrphanMediaCheckService, runOrphanMediaCheck, scheduleOrphanMediaCheck } from '@/lib/services/orphan-media-check';

const CALLER = { id: 1, googleId: 'g-1' };

describe('scheduled orphan media check (#946)', () => {
  let dataDir: string;
  let mediaDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'orphan-media-check-'));
    mediaDir = path.join(dataDir, 'uploads', '7', 'media');
    await mkdir(mediaDir, { recursive: true });
    process.env.DATA_DIR = dataDir;
    referenced.paths = ['kept.jpg'];
    admin.ok = true;
    delete (globalThis as { __orphanMediaCheck?: unknown }).__orphanMediaCheck;
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete process.env.DATA_DIR;
    await rm(dataDir, { recursive: true, force: true });
  });

  async function put(name: string, bytes: number, ageMs = 2 * 24 * 3_600_000) {
    const target = path.join(mediaDir, name);
    await writeFile(target, Buffer.alloc(bytes, 1));
    const when = new Date(Date.now() - ageMs);
    await utimes(target, when, when);
  }

  it('counts unreferenced files past the grace period and deletes nothing', async () => {
    await put('kept.jpg', 10);
    await put('orphan.jpg', 30);
    await put('fresh.jpg', 50, 60_000);

    const check = await runOrphanMediaCheck();

    expect(check).toMatchObject({ files: 1, bytes: 30, skipped: 0, graceHours: 24 });
    expect((await readdir(mediaDir)).sort()).toEqual(['fresh.jpg', 'kept.jpg', 'orphan.jpg']);
  });

  it('refuses anyone who is not an admin', async () => {
    admin.ok = false;
    await expect(getOrphanMediaCheckService(CALLER)).rejects.toThrow('Only an admin');
  });

  it('gives admins the latest result, running a first check when none has finished', async () => {
    await put('orphan.jpg', 30);
    const first = await getOrphanMediaCheckService(CALLER);
    expect(first.check).toMatchObject({ files: 1, bytes: 30 });

    await put('second.jpg', 5);
    expect((await getOrphanMediaCheckService(CALLER)).check).toEqual(first.check);
  });

  it('schedules one daily dry run, however often it is started', async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    scheduleOrphanMediaCheck();
    scheduleOrphanMediaCheck();
    expect(timeout).toHaveBeenCalledTimes(1);
  });
});
