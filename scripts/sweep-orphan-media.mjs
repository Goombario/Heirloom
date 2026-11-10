// Sweep media files that no Media row references (#860).
//
// Plain Node ESM on purpose: the production image is a Next standalone build
// with no tsx and no TypeScript sources, so this file is copied into the
// runner image and run there, next to the volume:
//
//   node scripts/sweep-orphan-media.mjs                 # dry run (default)
//   node scripts/sweep-orphan-media.mjs --list          # dry run + file list
//   node scripts/sweep-orphan-media.mjs --apply         # delete the orphans
//   node scripts/sweep-orphan-media.mjs --grace-hours=48
//
// Reads DATABASE_URL and DATA_DIR (falls back to ./data, like lib/data-dir.ts).
// A file is kept when any Media row, in any tree, has its basename as
// "FilePath" — a deliberately global reference set, so a collision can only
// keep a file, never delete one. Files modified within the grace period are
// never touched, so the sweep cannot race an upload or import materialization
// that has written its file but not yet committed its row.
//
// The thumbnail naming below must stay in step with lib/media-thumbnail.ts
// (thumbPathFor / legacyThumbPrefix); the unit test checks it against the real
// primeThumbnailCache output.

import { createHash } from 'node:crypto';
import { lstat, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_GRACE_HOURS = 24;
const MIN_GRACE_HOURS = 1;
const THUMBS_DIR = '.thumbs';
const OWNER_DIR = /^\d+$/;

/** Every prefix a live file's thumbnails may start with: hashed and legacy. */
function livePrefixesFor(filenames) {
  const prefixes = new Set();
  for (const filename of filenames) {
    prefixes.add(`${createHash('sha256').update(filename, 'utf8').digest('hex')}_`);
    prefixes.add(`${path.parse(filename).name}_`);
  }
  return prefixes;
}

/**
 * A thumbnail is live when any prefix of its name that ends in "_" belongs to
 * a referenced file. Checking every "_" boundary keeps legacy names such as
 * `a_b_256.jpg` alive for both `a.jpg` and `a_b.jpg` — erring toward keeping.
 */
export function isLiveThumbnail(name, livePrefixes) {
  for (let index = name.indexOf('_'); index !== -1; index = name.indexOf('_', index + 1)) {
    if (livePrefixes.has(name.slice(0, index + 1))) return true;
  }
  return false;
}

function normalizeReferenced(filePaths) {
  const names = new Set();
  for (const filePath of filePaths) {
    if (typeof filePath === 'string' && filePath !== '') names.add(path.basename(filePath));
  }
  return names;
}

async function lstatOrNull(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Identity of a real (non-symlink) directory, or null when it isn't one. */
async function directoryIdentity(dir) {
  const stats = await lstatOrNull(dir);
  if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) return null;
  return { dev: stats.dev, ino: stats.ino, resolved: await realpath(dir) };
}

async function assertDirectoryUnchanged(dir, identity) {
  const current = await directoryIdentity(dir);
  if (!current || current.dev !== identity.dev || current.ino !== identity.ino
      || current.resolved !== identity.resolved) {
    throw new Error('Media directory changed during sweep');
  }
}

function emptyTally() {
  return { orphans: 0, orphanBytes: 0, referenced: 0, young: 0 };
}

/**
 * Classify one directory's regular files. Symlinks, subdirectories and other
 * special entries are skipped and counted, never followed or removed.
 */
async function classifyDirectory({ dir, identity, kind, isReferenced, cutoffMs, tally, owner, candidates }) {
  for (const name of await readdir(dir)) {
    if (kind === 'original' && name === THUMBS_DIR) continue;
    const entryPath = path.join(dir, name);
    const stats = await lstatOrNull(entryPath);
    if (!stats) continue;
    if (stats.isSymbolicLink() || !stats.isFile()) {
      owner.skipped++;
      continue;
    }
    if (isReferenced(name)) {
      tally.referenced++;
      continue;
    }
    if (stats.mtimeMs > cutoffMs) {
      tally.young++;
      continue;
    }
    tally.orphans++;
    tally.orphanBytes += stats.size;
    candidates.push({
      kind, ownerId: owner.ownerId, name, dir, identity, size: stats.size,
      dev: stats.dev, ino: stats.ino, mtimeMs: stats.mtimeMs,
    });
  }
}

/**
 * Find (and, with `apply`, delete) media originals and thumbnails under
 * `<dataDir>/uploads/<ownerId>/media/` that no Media row references.
 *
 * @param {{
 *   dataDir: string,
 *   listReferencedFilePaths: () => Promise<Iterable<string | null>>,
 *   apply?: boolean,
 *   graceHours?: number,
 *   now?: () => number,
 *   unlinkFile?: (target: string) => Promise<void>,
 * }} options
 */
export async function sweepOrphanMedia(options) {
  const graceHours = options.graceHours ?? DEFAULT_GRACE_HOURS;
  if (!Number.isFinite(graceHours) || graceHours < MIN_GRACE_HOURS) {
    throw new Error(`Grace period must be at least ${MIN_GRACE_HOURS} hour(s)`);
  }
  const apply = options.apply === true;
  const removeFile = options.unlinkFile ?? unlink;
  const cutoffMs = (options.now ?? Date.now)() - graceHours * 3_600_000;

  /**
   * @typedef {{ orphans: number, orphanBytes: number, referenced: number, young: number }} Tally
   * @type {{
   *   mode: 'apply' | 'dry-run',
   *   graceHours: number,
   *   owners: Array<{ ownerId: number, originals: Tally, thumbnails: Tally, skipped: number }>,
   *   totals: { originals: Tally, thumbnails: Tally, skipped: number },
   *   deleted: { count: number, bytes: number },
   *   failed: number,
   *   files: Array<{ path: string, kind: 'original' | 'thumbnail', bytes: number, modified: string }>,
   * }}
   */
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    graceHours,
    owners: [],
    totals: { originals: emptyTally(), thumbnails: emptyTally(), skipped: 0 },
    deleted: { count: 0, bytes: 0 },
    failed: 0,
    files: [],
  };

  const uploadsDir = path.join(options.dataDir, 'uploads');
  const uploadsStats = await lstatOrNull(uploadsDir);
  if (!uploadsStats) return report;
  if (uploadsStats.isSymbolicLink() || !uploadsStats.isDirectory()) {
    throw new Error('Uploads path is not a real directory');
  }

  let referenced = normalizeReferenced(await options.listReferencedFilePaths());
  let livePrefixes = livePrefixesFor(referenced);
  const candidates = [];

  for (const ownerName of (await readdir(uploadsDir)).sort()) {
    if (!OWNER_DIR.test(ownerName)) continue;
    const owner = {
      ownerId: Number(ownerName), originals: emptyTally(), thumbnails: emptyTally(), skipped: 0,
    };
    if (!await directoryIdentity(path.join(uploadsDir, ownerName))) {
      owner.skipped++;
      report.owners.push(owner);
      continue;
    }
    const mediaDir = path.join(uploadsDir, ownerName, 'media');
    const mediaIdentity = await directoryIdentity(mediaDir);
    if (!mediaIdentity) {
      if (await lstatOrNull(mediaDir)) {
        owner.skipped++;
        report.owners.push(owner);
      }
      continue;
    }

    await classifyDirectory({
      dir: mediaDir, identity: mediaIdentity, kind: 'original',
      isReferenced: (name) => referenced.has(name), cutoffMs, tally: owner.originals, owner, candidates,
    });

    const thumbsDir = path.join(mediaDir, THUMBS_DIR);
    const thumbsIdentity = await directoryIdentity(thumbsDir);
    if (thumbsIdentity) {
      await classifyDirectory({
        dir: thumbsDir, identity: thumbsIdentity, kind: 'thumbnail',
        isReferenced: (name) => isLiveThumbnail(name, livePrefixes), cutoffMs, tally: owner.thumbnails, owner, candidates,
      });
    } else if (await lstatOrNull(thumbsDir)) {
      owner.skipped++;
    }
    report.owners.push(owner);
  }

  if (apply && candidates.length > 0 && referenced.size === 0) {
    // An empty reference set almost always means the wrong database, and
    // would condemn every file on the volume.
    throw new Error('No Media row references any file; refusing to apply (check DATABASE_URL)');
  }
  if (apply && candidates.length > 0) {
    // Re-read references right before deleting: a row committed during the
    // scan wins over the scan's verdict.
    referenced = normalizeReferenced(await options.listReferencedFilePaths());
    livePrefixes = livePrefixesFor(referenced);
  }

  for (const candidate of candidates) {
    const relative = path.relative(uploadsDir, path.join(candidate.dir, candidate.name));
    report.files.push({
      path: relative, kind: candidate.kind, bytes: candidate.size,
      modified: new Date(candidate.mtimeMs).toISOString(),
    });
    if (!apply) continue;
    const nowReferenced = candidate.kind === 'original'
      ? referenced.has(candidate.name)
      : isLiveThumbnail(candidate.name, livePrefixes);
    if (nowReferenced) continue;
    const entryPath = path.join(candidate.dir, candidate.name);
    try {
      await assertDirectoryUnchanged(candidate.dir, candidate.identity);
      const stats = await lstat(entryPath);
      if (stats.isSymbolicLink() || !stats.isFile() || stats.dev !== candidate.dev
          || stats.ino !== candidate.ino || stats.mtimeMs > cutoffMs) {
        continue;
      }
      await removeFile(entryPath);
      report.deleted.count++;
      report.deleted.bytes += candidate.size;
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      report.failed++;
    }
  }

  for (const owner of report.owners) {
    for (const kind of ['originals', 'thumbnails']) {
      for (const key of Object.keys(owner[kind])) report.totals[kind][key] += owner[kind][key];
    }
    report.totals.skipped += owner.skipped;
  }
  return report;
}

/** Parse CLI flags; unknown flags are an error so a typo never deletes. */
export function parseSweepArgs(argv) {
  const parsed = { apply: false, list: false, graceHours: DEFAULT_GRACE_HOURS };
  for (const arg of argv) {
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--list') parsed.list = true;
    else if (arg.startsWith('--grace-hours=')) {
      const value = arg.slice('--grace-hours='.length);
      parsed.graceHours = /^\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function main() {
  const args = parseSweepArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL environment variable is not set');

  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const report = await sweepOrphanMedia({
      dataDir: process.env.DATA_DIR || path.join(process.cwd(), 'data'),
      apply: args.apply,
      graceHours: args.graceHours,
      listReferencedFilePaths: async () => {
        const result = await pool.query(
          'SELECT DISTINCT "FilePath" FROM "Media" WHERE "FilePath" IS NOT NULL',
        );
        return result.rows.map((row) => row.FilePath);
      },
    });
    const { files, ...summary } = report;
    process.stdout.write(`${JSON.stringify(args.list ? { ...summary, files } : summary, null, 2)}\n`);
    if (report.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
