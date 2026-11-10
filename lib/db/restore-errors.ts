// Kept apart from connection.pglite.ts so UI code (and its tests, which mock
// that module) can recognise a refused restore without loading PGlite.

/**
 * A restore that stopped before replacing anything, for a reason the user can
 * act on (#879):
 * - `newer_backup`: the backup was written by a newer build of the app;
 * - `other_tabs`: another tab of the app has the database open;
 * - `no_rollback`: the current data couldn't be copied aside first.
 */
export class RestoreRefusedError extends Error {
  constructor(readonly reason: 'newer_backup' | 'other_tabs' | 'no_rollback') {
    super(`Restore refused: ${reason}`);
    this.name = 'RestoreRefusedError';
  }
}

/** The `options` message key that explains a failed restore. */
export function restoreErrorKey(err: unknown):
  'restore_failed' | 'restore_failed_newer_backup' | 'restore_failed_other_tabs' | 'restore_failed_no_rollback' {
  return err instanceof RestoreRefusedError ? `restore_failed_${err.reason}` : 'restore_failed';
}
