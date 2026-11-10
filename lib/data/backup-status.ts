/**
 * Backup freshness logic for the local-first build — pure, framework-free so it
 * is trivially unit-testable. The React hook (`useBackupStatus`) wraps this with
 * localStorage reads and live event wiring.
 */

/** A backup older than this many days is "stale" and warrants a nudge. */
export const STALE_AFTER_DAYS = 14;
/** Between this and STALE, the backup is "aging" (informational, no nudge). */
export const AGING_AFTER_DAYS = 7;

/** localStorage keys written by the existing file / Drive backup flows. */
export const FILE_BACKUP_KEY = 'heirloom_last_backup';
export const DRIVE_BACKUP_KEY = 'heirloom_last_drive_backup';
/** Fired on `window` after any successful backup so live surfaces refresh. */
export const BACKUP_EVENT = 'heirloom:backup';

type BackupStatusLevel = 'fresh' | 'aging' | 'stale' | 'never';

export interface BackupStatus {
  /** Most recent of the file/Drive backups, or null if never backed up. */
  lastBackup: Date | null;
  /** Whole days since `lastBackup`, or null when never. */
  ageDays: number | null;
  level: BackupStatusLevel;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse an ISO string to a valid Date, or null. */
function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Compute backup freshness from the two stored timestamps. The most recent of
 * the file and Drive backups wins.
 */
export function computeBackupStatus(
  fileIso: string | null,
  driveIso: string | null,
  now: Date = new Date(),
): BackupStatus {
  const file = parseIso(fileIso);
  const drive = parseIso(driveIso);

  const lastBackup =
    file && drive ? (file > drive ? file : drive) : (file ?? drive ?? null);

  if (!lastBackup) return { lastBackup: null, ageDays: null, level: 'never' };

  const ageDays = Math.max(0, Math.floor((now.getTime() - lastBackup.getTime()) / MS_PER_DAY));
  const level: BackupStatusLevel =
    ageDays >= STALE_AFTER_DAYS ? 'stale' : ageDays >= AGING_AFTER_DAYS ? 'aging' : 'fresh';

  return { lastBackup, ageDays, level };
}

/** Emit the live-refresh event. No-op outside a browser. */
export function notifyBackup(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BACKUP_EVENT));
}
