import { describe, it, expect, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  __setTestDb,
  dumpDatabaseLogical,
  inspectBackupLogical,
  loadDatabase,
  query,
  validateDump,
} from '@/lib/db/connection.pglite';
import { RestoreRefusedError, restoreErrorKey } from '@/lib/db/restore-errors';
import { SCHEMA_VERSION } from '@/lib/db/init-schema';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

async function dbAtVersion(version: number): Promise<PGlite> {
  const db = await newEmptyClusterDb();
  await db.exec(`
    CREATE TABLE "_SchemaMeta" ("Version" INTEGER NOT NULL);
    INSERT INTO "_SchemaMeta" ("Version") VALUES (${version});
    CREATE TABLE "Trees" ("Id" int PRIMARY KEY);
    CREATE TABLE "People" ("Id" int PRIMARY KEY);
    CREATE TABLE "Families" ("Id" int PRIMARY KEY);
    CREATE TABLE "Media" ("Id" int PRIMARY KEY);
    CREATE TABLE "MediaBlob" ("MediaId" int PRIMARY KEY REFERENCES "Media"("Id"), "Data" bytea NOT NULL);
    CREATE TABLE "MediaThumb" ("MediaId" int PRIMARY KEY REFERENCES "Media"("Id"), "Data" bytea NOT NULL);
  `);
  return db;
}

const reasonOf = (p: Promise<unknown>) => p.then(
  () => 'resolved',
  (err) => (err instanceof RestoreRefusedError ? err.reason : `other: ${String(err)}`),
);

/** No room for a second copy: the restore replaces the database in place (#951). */
function lowStorage(): void {
  vi.stubGlobal('navigator', {
    locks: navigator.locks,
    storage: { estimate: () => Promise.resolve({ quota: 1_000, usage: 999 }) },
  });
}

afterEach(() => {
  __setTestDb(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('restore safety net (#879)', () => {
  it('refuses a backup written by a newer schema, before anything is replaced', async () => {
    const newer = await dbAtVersion(SCHEMA_VERSION + 1);
    const datadir = await newer.dumpDataDir('none');
    __setTestDb(newer);
    const container = await dumpDatabaseLogical();
    __setTestDb(null);
    await newer.close();

    expect(await reasonOf(validateDump(datadir))).toBe('newer_backup');
    expect(await reasonOf(inspectBackupLogical(container))).toBe('newer_backup');
  }, 30_000); // ~9s on a slow CI runner: inspecting the backup boots PGlite

  it('accepts a backup at the current or an older schema version', async () => {
    for (const version of [SCHEMA_VERSION, SCHEMA_VERSION - 1]) {
      const db = await dbAtVersion(version);
      await expect(validateDump(await db.dumpDataDir('none'))).resolves.toBeUndefined();
      await db.close();
    }
  });

  it('replacing in place, stops when the rollback snapshot of the current data fails', async () => {
    const incoming = await dbAtVersion(SCHEMA_VERSION);
    const dump = await incoming.dumpDataDir('none');
    await incoming.close();
    const live = await dbAtVersion(SCHEMA_VERSION);
    live.dumpDataDir = () => Promise.reject(new Error('out of memory'));
    __setTestDb(live);
    const deleteDatabase = vi.fn();
    vi.stubGlobal('indexedDB', { deleteDatabase });
    lowStorage();

    expect(await reasonOf(loadDatabase(dump))).toBe('no_rollback');
    expect(deleteDatabase).not.toHaveBeenCalled();
    await live.close();
  });

  it('refuses while another tab holds the database, and deletes nothing', async () => {
    const incoming = await dbAtVersion(SCHEMA_VERSION);
    const dump = await incoming.dumpDataDir('none');
    await incoming.close();
    __setTestDb(await dbAtVersion(SCHEMA_VERSION));
    const deleteDatabase = vi.fn();
    vi.stubGlobal('indexedDB', { deleteDatabase });
    // ifAvailable: another tab's shared hold means the exclusive lock is not granted.
    vi.stubGlobal('navigator', {
      locks: { request: (_name: string, _opts: object, cb: (lock: null) => unknown) => Promise.resolve(cb(null)) },
    });

    expect(await reasonOf(loadDatabase(dump))).toBe('other_tabs');
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it('replacing in place, stays in restore mode while a timed-out delete is still queued, then writes the rollback back', async () => {
    const incoming = await dbAtVersion(SCHEMA_VERSION);
    const dump = await incoming.dumpDataDir('none');
    await incoming.close();
    __setTestDb(await dbAtVersion(SCHEMA_VERSION));
    const request: { onblocked?: () => void; onsuccess?: () => void } = {};
    let signalBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => { signalBlocked = resolve; });
    vi.stubGlobal('indexedDB', {
      deleteDatabase: () => { queueMicrotask(() => { request.onblocked?.(); signalBlocked(); }); return request; },
    });
    lowStorage();

    // Skip the real grace period: fast-forward the blocked delete's timeout.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const refused = reasonOf(loadDatabase(dump));
    await blocked;
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    expect(await refused).toBe('other_tabs');
    // The queued delete would wipe whatever this tab reopened, so queries wait.
    await expect(query('SELECT 1')).rejects.toThrow(/being restored/);

    request.onsuccess?.(); // the blocking tab closed; the rollback write-back runs
    await vi.waitFor(async () => {
      await expect(query('SELECT 1')).rejects.not.toThrow(/being restored/);
    });
  });

  it('with room for a second copy, a blocked delete refuses without touching the live data', async () => {
    const incoming = await dbAtVersion(SCHEMA_VERSION);
    const dump = await incoming.dumpDataDir('none');
    await incoming.close();
    __setTestDb(await dbAtVersion(SCHEMA_VERSION));
    const deleted: string[] = [];
    const request: { onblocked?: () => void } = {};
    let signalBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => { signalBlocked = resolve; });
    vi.stubGlobal('indexedDB', {
      deleteDatabase: (name: string) => {
        deleted.push(name);
        queueMicrotask(() => { request.onblocked?.(); signalBlocked(); });
        return request;
      },
    });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const refused = reasonOf(loadDatabase(dump));
    await blocked;
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    expect(await refused).toBe('other_tabs');
    // Only the copy that isn't live was touched, so the tab carries on at once.
    expect(deleted).toEqual(['/pglite/heirloom-2']);
    await expect(query('SELECT 1')).resolves.toBeDefined();
  });

  it('maps each refusal to its own message', () => {
    expect(restoreErrorKey(new RestoreRefusedError('other_tabs'))).toBe('restore_failed_other_tabs');
    expect(restoreErrorKey(new Error('corrupt'))).toBe('restore_failed');
  });
});
