import { dumpDatabaseLogical, inspectBackupLogical, type DatabaseTotals } from '@/lib/db/connection.pglite';
import { verifyContainer } from '@/lib/db/backup-container';
import { getToken } from './auth';
import {
  ensureBackupFolder,
  uploadBackup,
  listBackups,
  downloadBackup,
  pruneBackups,
  type DriveFile,
} from './client';

/**
 * Orchestration layer: ties the Drive REST transport (`client.ts`) and the GIS
 * token (`auth.ts`) to the PGlite logical (SQL) snapshot primitives
 * (`dumpDatabaseLogical` / `inspectBackupLogical`). This is the surface the UI calls.
 */

export type { DriveFile };

/** e.g. `heirloom-backup-2026-07-01T08-36-00.hlbak` (colon-free for filesystem
 *  friendliness; `.hlbak` is the binary hybrid container from `dumpDatabaseLogical`). */
function backupFileName(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  return `heirloom-backup-${stamp}.hlbak`;
}

/**
 * Snapshot the local database and upload it to the Heirloom folder in Drive,
 * then prune older backups down to the retention limit. Returns the new file.
 *
 * Pruning only happens once the new backup is known to be whole: the container
 * reads back to its last byte, and Drive stored exactly that many bytes (#878).
 * Otherwise this throws and every older backup is kept.
 */
export async function backupToDrive(): Promise<DriveFile> {
  const token = await getToken(false);
  const folderId = await ensureBackupFolder(token);
  const blob = await dumpDatabaseLogical();
  await verifyContainer(blob);
  const file = await uploadBackup(token, blob, folderId, backupFileName());
  if (Number(file.size) !== blob.size) {
    throw new Error(`Drive stored ${file.size ?? 'no'} bytes of a ${blob.size}-byte backup; older backups were kept`);
  }
  await pruneBackups(token, folderId);
  return file;
}

/** List existing Heirloom backups in Drive, newest first. */
export async function listDriveBackups(): Promise<DriveFile[]> {
  const token = await getToken(false);
  const folderId = await ensureBackupFolder(token);
  return listBackups(token, folderId);
}

/**
 * Download a backup from Drive and read it without touching the live database
 * (BK-1, #850): its rebuilt datadir and what it holds. An unreadable file throws
 * here, before the restore confirmation opens. Restore by passing the datadir to
 * `loadDatabase`, which keeps its validate → snapshot → clear → load → rollback
 * safety and doesn't download again.
 */
export async function inspectDriveBackup(fileId: string): Promise<{ datadir: Blob; totals: DatabaseTotals }> {
  const token = await getToken(false);
  const blob = await downloadBackup(token, fileId);
  return inspectBackupLogical(blob);
}
