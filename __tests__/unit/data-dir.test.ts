import { describe, it, expect } from 'vitest';
import {
  DATA_DIRS,
  idbDatabaseName,
  readPointer,
  resolveDataDir,
  restoreIntoOtherDataDir,
  writePointer,
  type DataDir,
  type PointerStore,
  type RestoreSteps,
} from '@/lib/db/data-dir';

const [A, B] = DATA_DIRS;

function memoryStorage(): PointerStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

/**
 * IndexedDB as the restore sees it: each data directory holds a backup's
 * contents, or 'partial' while a write is half done. A step named in `crashAt`
 * throws as if the tab were killed there, after doing its damage; once killed,
 * no later step (the restore's own cleanup included) changes anything.
 */
class FakeBrowser {
  dbs = new Map<DataDir, string>();
  storage = memoryStorage();
  constructor(live: DataDir, contents: string) {
    this.dbs.set(live, contents);
    writePointer(live, this.storage);
  }

  steps(crashAt?: string): RestoreSteps {
    let step = 0;
    let killed = false;
    const alive = () => { if (killed) throw new Error('killed'); };
    const at = (name: string) => {
      step++;
      if (crashAt === `${step}:${name}`) {
        killed = true;
        throw new Error('killed');
      }
    };
    return {
      deleteDb: async (dir) => { alive(); this.dbs.delete(dir); at('delete'); },
      writeDb: async (dir, datadir) => {
        alive();
        this.dbs.set(dir, 'partial');
        at('write-partial');
        this.dbs.set(dir, await datadir.text());
        at('write');
      },
      verifyDb: async (dir) => {
        alive();
        if (this.dbs.get(dir) === 'partial') throw new Error('not loadable');
        at('verify');
      },
      writePointer: (dir) => { alive(); writePointer(dir, this.storage); at('pointer'); },
    };
  }

  /** What a fresh page load opens. */
  boot(): string | undefined {
    const existing = new Set([...this.dbs.keys()].map(idbDatabaseName));
    const { open } = resolveDataDir(readPointer(this.storage), existing);
    return this.dbs.get(open);
  }
}

describe('data directory pointer (#951)', () => {
  it('defaults to the first data directory and ignores a bad pointer', () => {
    const storage = memoryStorage();
    expect(readPointer(storage)).toBe(A);
    storage.setItem('heirloom-data-dir', 'idb://elsewhere');
    expect(readPointer(storage)).toBe(A);
    writePointer(B, storage);
    expect(readPointer(storage)).toBe(B);
    expect(readPointer(null)).toBe(A);
  });

  it('opens the pointer\'s database and names the other one a leftover', () => {
    const both = new Set([idbDatabaseName(A), idbDatabaseName(B)]);
    expect(resolveDataDir(B, both)).toEqual({ open: B, leftover: A });
    expect(resolveDataDir(A, new Set([idbDatabaseName(A)]))).toEqual({ open: A, leftover: null });
  });

  it('opens the other database when the pointer\'s one is missing', () => {
    expect(resolveDataDir(A, new Set([idbDatabaseName(B)]))).toEqual({ open: B, leftover: null });
  });

  it('trusts the pointer when the browser cannot list databases, or nothing exists yet', () => {
    expect(resolveDataDir(B, null)).toEqual({ open: B, leftover: null });
    expect(resolveDataDir(A, new Set())).toEqual({ open: A, leftover: null });
  });

  it('restores into the other directory, switches, and deletes the old one', async () => {
    const browser = new FakeBrowser(A, 'old');
    await restoreIntoOtherDataDir(browser.steps(), A, new Blob(['new']));
    expect(readPointer(browser.storage)).toBe(B);
    expect([...browser.dbs]).toEqual([[B, 'new']]);
    expect(browser.boot()).toBe('new');
  });

  it('clears a leftover in the target before writing', async () => {
    const browser = new FakeBrowser(B, 'old');
    browser.dbs.set(A, 'partial');
    await restoreIntoOtherDataDir(browser.steps(), B, new Blob(['new']));
    expect(browser.boot()).toBe('new');
  });

  it('leaves the old data live when the copy fails to verify', async () => {
    const browser = new FakeBrowser(A, 'old');
    const steps = browser.steps();
    steps.verifyDb = async () => { throw new Error('unreadable'); };
    await expect(restoreIntoOtherDataDir(steps, A, new Blob(['new']))).rejects.toThrow('unreadable');
    expect(readPointer(browser.storage)).toBe(A);
    expect([...browser.dbs]).toEqual([[A, 'old']]);
  });

  it('treats a failed delete of the old database as a leftover, not a failure', async () => {
    const browser = new FakeBrowser(A, 'old');
    const steps = browser.steps();
    const deleteDb = steps.deleteDb;
    steps.deleteDb = async (dir) => { if (dir === A) throw new Error('blocked'); await deleteDb(dir); };
    await restoreIntoOtherDataDir(steps, A, new Blob(['new']));
    expect(browser.dbs.get(A)).toBe('old');
    expect(browser.boot()).toBe('new');
  });

  // Acceptance: a tab killed at any step leaves the old database or the new one
  // fully loadable, never neither.
  const crashPoints = ['1:delete', '2:write-partial', '3:write', '4:verify', '5:pointer', '6:delete'];
  it.each(crashPoints)('a tab killed at %s still boots into complete data', async (crashAt) => {
    const browser = new FakeBrowser(A, 'old');
    // A kill stops the tab; nothing after the step runs. (The last delete's
    // failure is swallowed, so the restore itself may still resolve.)
    await restoreIntoOtherDataDir(browser.steps(crashAt), A, new Blob(['new'])).catch(() => {});
    expect(['old', 'new']).toContain(browser.boot());
  });

  it('runs every step the crash table names', async () => {
    const seen: string[] = [];
    const browser = new FakeBrowser(A, 'old');
    const steps = browser.steps();
    const wrapped: RestoreSteps = {
      deleteDb: async (d) => { seen.push('delete'); await steps.deleteDb(d); },
      writeDb: async (d, b) => { seen.push('write-partial', 'write'); await steps.writeDb(d, b); },
      verifyDb: async (d) => { seen.push('verify'); await steps.verifyDb(d); },
      writePointer: (d) => { seen.push('pointer'); steps.writePointer(d); },
    };
    await restoreIntoOtherDataDir(wrapped, A, new Blob(['new']));
    expect(seen.map((s, i) => `${i + 1}:${s}`)).toEqual(crashPoints);
  });
});
