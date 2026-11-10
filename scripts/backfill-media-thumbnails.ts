import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDataDir } from '../lib/data-dir';
import { listHostedMediaForThumbnailBackfill, type HostedMediaThumbnailBackfillRow } from '../lib/db/queries/media';
import { primeThumbnailCache } from '../lib/media-thumbnail';
import { MAX_HOSTED_ORIGINAL_BYTES, readHostedOriginal } from '../lib/media-original';

export interface MediaThumbnailBackfillDeps {
  listRows?: (afterId: number, limit: number) => Promise<HostedMediaThumbnailBackfillRow[]>;
  lstat?: (filePath: string) => Promise<{ isSymbolicLink(): boolean; isFile(): boolean; size: number; dev: number; ino: number }>;
  realpath?: (filePath: string) => Promise<string>;
  /** Test-only byte source override; production always uses readHostedOriginal. */
  readFile?: (filePath: string) => Promise<Buffer>;
  primeThumbnailCache?: typeof primeThumbnailCache;
  getDataDir?: () => string;
}

const BACKFILL_PAGE_SIZE = 100;
export interface MediaThumbnailBackfillResult {
  scanned: number;
  created: number;
  skipped: number;
  failed: number;
}

/**
 * Populate missing hosted 256px caches without changing database rows or
 * originals. Work is deliberately sequential so the command is restartable
 * and cannot create an unbounded Sharp workload.
 */
export async function backfillMediaThumbnails(
  deps: MediaThumbnailBackfillDeps = {},
): Promise<MediaThumbnailBackfillResult> {
  const listRows = deps.listRows ?? listHostedMediaForThumbnailBackfill;
  const inspectOriginal = deps.lstat ?? lstat;
  const resolvePath = deps.realpath ?? realpath;
  const readOriginal = deps.readFile;
  const prime = deps.primeThumbnailCache ?? primeThumbnailCache;
  const dataDir = deps.getDataDir ?? getDataDir;
  const result: MediaThumbnailBackfillResult = { scanned: 0, created: 0, skipped: 0, failed: 0 };

  let afterId = 0;
  while (true) {
    let rows: HostedMediaThumbnailBackfillRow[];
    try {
      rows = await listRows(afterId, BACKFILL_PAGE_SIZE);
    } catch {
      result.failed++;
      break;
    }
    if (rows.length === 0) break;
    for (const row of rows) {
      result.scanned++;
      afterId = Math.max(afterId, row.Id);
      const filename = row.FilePath;
      if (!filename || path.basename(filename) !== filename || typeof row.ContentType !== 'string') {
        result.failed++;
        continue;
      }

      const mediaDir = path.resolve(dataDir(), 'uploads', String(row.UserId), 'media');
      const originalPath = path.resolve(mediaDir, filename);
      try {
        const originalStat = await inspectOriginal(originalPath);
        if (originalStat.isSymbolicLink() || !originalStat.isFile()) throw new Error('invalid original entry');
        if (originalStat.size > MAX_HOSTED_ORIGINAL_BYTES) throw new Error('original too large');
        const [resolvedMediaDir, resolvedOriginalPath] = await Promise.all([
          resolvePath(mediaDir),
          resolvePath(originalPath),
        ]);
        if (path.dirname(resolvedOriginalPath) !== resolvedMediaDir) throw new Error('original outside media directory');
        const original = readOriginal
          ? await readOriginal(originalPath)
          : await readHostedOriginal({ mediaDir, filename });
        const outcome = await prime({
          original,
          userId: row.UserId,
          filename,
          size: 256,
          contentType: row.ContentType,
        });
        if (outcome === 'created') result.created++;
        else result.skipped++;
      } catch {
        result.failed++;
      }
    }
    if (rows.length < BACKFILL_PAGE_SIZE) break;
  }

  return result;
}

export interface MediaThumbnailBackfillCliDeps {
  run?: () => Promise<MediaThumbnailBackfillResult>;
  closePool?: () => Promise<void>;
}

export async function runBackfillMediaThumbnailsCli(
  deps: MediaThumbnailBackfillCliDeps = {},
): Promise<MediaThumbnailBackfillResult> {
  const result: MediaThumbnailBackfillResult = { scanned: 0, created: 0, skipped: 0, failed: 0 };
  try {
    return await (deps.run ?? (() => backfillMediaThumbnails()))();
  } catch {
    return { ...result, failed: 1 };
  } finally {
    try {
      const { closePool } = await import('../lib/db/connection');
      await (deps.closePool ?? closePool)();
    } catch {
      // CLI cleanup is best effort; the stable aggregate remains the output.
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runBackfillMediaThumbnailsCli();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.failed > 0) process.exitCode = 1;
}
