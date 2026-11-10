import { describe, it, expect, afterEach, vi } from 'vitest';
import type { PGliteInterface } from '@electric-sql/pglite';
import { LeaderChangedError } from '@electric-sql/pglite/worker';
import { __setTestDb, getClient, query } from '@/lib/db/connection.pglite';
import { DatabaseInterruptedError } from '@/lib/data/errors';
import { SCHEMA_VERSION } from '@/lib/db/init-schema';

type Handler = (text: string) => Promise<{ rows: unknown[] }>;

/** A PGliteWorker stand-in: the schema is current, and `handler` answers the rest. */
function fakeWorkerDb(handler: Handler) {
  const listeners = new Set<() => void>();
  const db = {
    waitReady: Promise.resolve(),
    onLeaderChange(fn: () => void) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    changeLeader() {
      for (const fn of [...listeners]) fn();
    },
    get watchers() { return listeners.size; },
    query: vi.fn(async (text: string) => {
      if (text.includes(`to_regclass('"_SchemaMeta"')`)) return { rows: [{ ok: true }] };
      if (text.includes('MAX("Version")')) return { rows: [{ v: SCHEMA_VERSION }] };
      return handler(text);
    }),
  };
  __setTestDb(db as unknown as PGliteInterface);
  return db;
}

const never = () => new Promise<never>(() => {});

afterEach(() => __setTestDb(null));

describe('a leader change under a query (#1009)', () => {
  it('re-runs a read on the new leader', async () => {
    let calls = 0;
    fakeWorkerDb(async () => {
      calls++;
      if (calls === 1) throw new LeaderChangedError();
      return { rows: [{ n: 1 }] };
    });
    await expect(query('SELECT 1 AS n')).resolves.toEqual({ rows: [{ n: 1 }], rowCount: 1 });
    expect(calls).toBe(2);
  });

  it('does not wait forever on a read whose reply was lost', async () => {
    let calls = 0;
    const db = fakeWorkerDb(async () => (++calls === 1 ? never() : { rows: [{ n: 1 }] }));
    const result = query('SELECT 1 AS n');
    await vi.waitFor(() => expect(calls).toBe(1));
    db.changeLeader();
    await expect(result).resolves.toEqual({ rows: [{ n: 1 }], rowCount: 1 });
    expect(db.watchers).toBe(0);
  });

  it('does not re-run a write, and says it may not have finished', async () => {
    let calls = 0;
    const db = fakeWorkerDb(async () => { calls++; return never(); });
    const result = query('INSERT INTO "People" DEFAULT VALUES');
    await vi.waitFor(() => expect(calls).toBe(1));
    db.changeLeader();
    await expect(result).rejects.toBeInstanceOf(DatabaseInterruptedError);
    expect(calls).toBe(1);
  });

  it('stops a transaction after a leader change between its statements', async () => {
    const run: string[] = [];
    const db = fakeWorkerDb(async (text) => { run.push(text); return { rows: [] }; });
    const client = await getClient();
    await client.query('BEGIN');
    await client.query('INSERT INTO "People" DEFAULT VALUES');
    db.changeLeader();
    // The next statement would autocommit on the new leader: refuse it.
    await expect(client.query('INSERT INTO "Families" DEFAULT VALUES')).rejects.toBeInstanceOf(DatabaseInterruptedError);
    // The caller's rollback has nothing left to undo.
    await expect(client.query('ROLLBACK')).resolves.toEqual({ rows: [], rowCount: 0 });
    client.release();
    expect(run).toEqual(['BEGIN', 'INSERT INTO "People" DEFAULT VALUES']);
    expect(db.watchers).toBe(0);
    // The next caller gets a working client.
    await expect(query('SELECT 1')).resolves.toBeDefined();
  });
});
