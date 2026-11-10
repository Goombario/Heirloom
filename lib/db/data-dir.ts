/**
 * The two IndexedDB-backed data directories a restore alternates between (#951).
 *
 * A restore loads the backup into the directory that isn't live, checks it,
 * then points the app at it, and only then deletes the old one. A crash at any
 * step leaves the pointer naming a complete database.
 */
export const DATA_DIRS = ['idb://heirloom', 'idb://heirloom-2'] as const;
export type DataDir = (typeof DATA_DIRS)[number];

/** localStorage key naming the live data directory. Absent means the first one. */
const POINTER_KEY = 'heirloom-data-dir';

/** The IndexedDB database name PGlite's IDBFS uses for `dir`. */
export function idbDatabaseName(dir: DataDir): string {
  return `/pglite/${dir.slice('idb://'.length)}`;
}

function otherDataDir(dir: DataDir): DataDir {
  return dir === DATA_DIRS[0] ? DATA_DIRS[1] : DATA_DIRS[0];
}

function isDataDir(value: unknown): value is DataDir {
  return (DATA_DIRS as readonly unknown[]).includes(value);
}

export interface PointerStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): PointerStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // storage blocked
  }
}

export function readPointer(storage: PointerStore | null = browserStorage()): DataDir {
  let value: string | null = null;
  try {
    value = storage?.getItem(POINTER_KEY) ?? null;
  } catch {
    // Unreadable storage: fall back to the default, which `resolveDataDir` checks.
  }
  return isDataDir(value) ? value : DATA_DIRS[0];
}

export function writePointer(dir: DataDir, storage: PointerStore | null = browserStorage()): void {
  if (!storage) throw new Error('Could not record the restored database');
  storage.setItem(POINTER_KEY, dir);
}

/**
 * Which data directory to open, given the pointer and the IndexedDB databases
 * that exist (`null` when the browser can't list them). The other one, when it
 * exists, is a leftover from an interrupted restore or a failed delete.
 *
 * The pointer is written only after its database is complete, so it wins when
 * both exist. If its database is missing but the other exists (the pointer
 * write was lost, or the storage was edited), the other one is the data.
 */
export function resolveDataDir(
  pointer: DataDir,
  existing: ReadonlySet<string> | null,
): { open: DataDir; leftover: DataDir | null } {
  if (!existing) return { open: pointer, leftover: null };
  const other = otherDataDir(pointer);
  const hasPointer = existing.has(idbDatabaseName(pointer));
  const hasOther = existing.has(idbDatabaseName(other));
  if (!hasPointer && hasOther) return { open: other, leftover: null };
  return { open: pointer, leftover: hasOther ? other : null };
}

/** The storage steps a restore runs, injectable so a test can crash between them. */
export interface RestoreSteps {
  deleteDb(dir: DataDir): Promise<void>;
  /** Write `datadir` into `dir`, which is empty. */
  writeDb(dir: DataDir, datadir: Blob): Promise<void>;
  /** Re-open `dir` from storage and read it back; throws when it isn't usable. */
  verifyDb(dir: DataDir): Promise<void>;
  writePointer(dir: DataDir): void;
}

/**
 * Restore `datadir` without ever deleting the live database first (#951):
 * load it into the other data directory, check it there, switch the pointer,
 * and only then delete the old one.
 *
 * Before the pointer switch, a failure or crash leaves `current` untouched and
 * the half-written copy is a leftover. After it, `current` is the leftover. A
 * failed delete of a leftover is not an error: the next boot cleans it up.
 */
export async function restoreIntoOtherDataDir(steps: RestoreSteps, current: DataDir, datadir: Blob): Promise<void> {
  const target = otherDataDir(current);
  // Any copy already there is a leftover; the live database is `current`.
  await steps.deleteDb(target);
  try {
    await steps.writeDb(target, datadir);
    await steps.verifyDb(target);
  } catch (err) {
    await steps.deleteDb(target).catch(() => {});
    throw err;
  }
  steps.writePointer(target);
  await steps.deleteDb(current).catch(() => {});
}
