import { describe, it, expect, beforeEach, vi } from 'vitest';

// A poisoned pg Pool used to stay poisoned for the life of the dev/server process:
// `pool.on('error')` logged and nothing else, so once the underlying sockets were
// unusable EVERY route 500'd until someone restarted the process (observed
// 2026-07-27 — all API routes failing while the Postgres container was healthy and
// idle). These tests pin the recovery path and the checkout timeout.

/** One fake pg Pool per construction, so a test can see whether a NEW one was built. */
class FakePool {
  static instances: FakePool[] = [];
  config: Record<string, unknown>;
  ended = false;
  handlers = new Map<string, (err: Error) => void>();
  query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  client = {
    query: vi.fn(async (_sql: string) => ({ rows: [], rowCount: 0 })),
    release: vi.fn(),
  };
  connect = vi.fn(async () => this.client);
  end = vi.fn(async () => { this.ended = true; });

  constructor(config: Record<string, unknown>) {
    this.config = config;
    FakePool.instances.push(this);
  }
  on(event: string, handler: (err: Error) => void) {
    this.handlers.set(event, handler);
    return this;
  }
  /** Simulate pg emitting an idle-client / connection error. */
  emitError(message = 'Connection terminated unexpectedly') {
    this.handlers.get('error')?.(new Error(message));
  }
}

vi.mock('pg', async () => {
  const { types } = await vi.importActual<typeof import('pg')>('pg');
  return { Pool: FakePool, types, default: { Pool: FakePool, types } };
});
// The real one issues ~80 DDL statements; the pool lifecycle is what's under test.
vi.mock('@/lib/db/init-schema', () => ({
  initializeSchema: vi.fn(async () => {}),
  SCHEMA_VERSION: 1,
}));

vi.mock('@/lib/db/init-membership', () => ({
  initializeMembershipSchema: vi.fn(async () => {}),
  reconcileMembership: vi.fn(async () => {}),
}));

async function freshConnection() {
  vi.resetModules();
  FakePool.instances = [];
  return import('@/lib/db/connection');
}

beforeEach(() => {
  process.env.DATABASE_URL = 'postgres://test@localhost:5432/test';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('PostgreSQL pool lifecycle', () => {
  it('reads int8 as a number, as PGlite does (#868)', async () => {
    const { query } = await freshConnection();
    await query('SELECT 1');

    const { getTypeParser } = FakePool.instances[0].config.types as {
      getTypeParser: (oid: number, format?: string) => (text: string) => unknown;
    };
    const int8 = getTypeParser(20);
    expect(int8('3')).toBe(3);
    expect(int8('9007199254740993')).toBe('9007199254740993');
    // Other types keep pg's parsers: int4 is a number, numeric stays text.
    expect(getTypeParser(23)('7')).toBe(7);
    expect(getTypeParser(1700)('1.50')).toBe('1.50');
  });

  it('reuses one pool across queries', async () => {
    const { query } = await freshConnection();

    await query('SELECT 1');
    await query('SELECT 2');

    expect(FakePool.instances).toHaveLength(1);
    expect(FakePool.instances[0].query).toHaveBeenCalledTimes(2);
  });

  it('rebuilds the pool after a connection error instead of staying poisoned', async () => {
    const { query } = await freshConnection();
    await query('SELECT 1');
    const poisoned = FakePool.instances[0];

    poisoned.emitError();
    await query('SELECT 2');

    expect(FakePool.instances).toHaveLength(2);
    expect(FakePool.instances[1]).not.toBe(poisoned);
    // The next query must NOT go through the discarded pool.
    expect(poisoned.query).toHaveBeenCalledTimes(1);
    expect(FakePool.instances[1].query).toHaveBeenCalledTimes(1);
  });

  it('drains the discarded pool so its sockets are not leaked', async () => {
    const { query } = await freshConnection();
    await query('SELECT 1');
    const poisoned = FakePool.instances[0];

    poisoned.emitError();
    await query('SELECT 2');

    expect(poisoned.end).toHaveBeenCalledTimes(1);
  });

  it('survives an end() that rejects while draining', async () => {
    const { query } = await freshConnection();
    await query('SELECT 1');
    const poisoned = FakePool.instances[0];
    poisoned.end.mockRejectedValueOnce(new Error('already ended'));

    poisoned.emitError();

    await expect(query('SELECT 2')).resolves.toBeDefined();
  });

  it('rebuilds for transaction clients too', async () => {
    const { query, getClient } = await freshConnection();
    await query('SELECT 1');
    FakePool.instances[0].emitError();

    await getClient();

    expect(FakePool.instances).toHaveLength(2);
    expect(FakePool.instances[1].connect).toHaveBeenCalledTimes(1);
  });

  it('does not re-run schema init against a rebuilt pool', async () => {
    const { query } = await freshConnection();
    // The module mock is shared file-wide, so its call count carries over from the
    // tests above; only this run's calls are interesting.
    const { initializeSchema } = await import('@/lib/db/init-schema');
    vi.mocked(initializeSchema).mockClear();
    await query('SELECT 1');

    FakePool.instances[0].emitError();
    await query('SELECT 2');

    // The schema lives in the DATABASE, which never went away — only our sockets did.
    expect(initializeSchema).toHaveBeenCalledTimes(1);
  });

  it('runs hosted schema initialization in one serialized transaction', async () => {
    const { query } = await freshConnection();
    const { initializeSchema } = await import('@/lib/db/init-schema');

    await query('SELECT 1');

    const client = FakePool.instances[0].client;
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      `SELECT pg_advisory_xact_lock(hashtext('genealogy_schema_init'))`,
      'COMMIT',
    ]);
    expect(initializeSchema).toHaveBeenCalledWith(client);
    // Hosted membership (#656) shares the same locked transaction.
    const { initializeMembershipSchema, reconcileMembership } = await import('@/lib/db/init-membership');
    expect(initializeMembershipSchema).toHaveBeenCalledWith(client);
    expect(reconcileMembership).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back an interrupted schema init and finishes it on the next query (#868)', async () => {
    const { query } = await freshConnection();
    const { initializeSchema } = await import('@/lib/db/init-schema');
    vi.mocked(initializeSchema).mockRejectedValueOnce(new Error('connection lost mid-migration'));

    await expect(query('SELECT 1')).rejects.toThrow('connection lost mid-migration');
    const client = FakePool.instances[0].client;
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      `SELECT pg_advisory_xact_lock(hashtext('genealogy_schema_init'))`,
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(FakePool.instances[0].query).not.toHaveBeenCalled();

    // The failed attempt is forgotten, so the next request runs the whole init again.
    client.query.mockClear();
    await query('SELECT 2');
    expect(client.query.mock.calls.map(([sql]) => sql).at(-1)).toBe('COMMIT');
    expect(FakePool.instances[0].query).toHaveBeenCalledWith('SELECT 2', undefined);
  });

  it('allows more than 2s to hand out a connection', async () => {
    const { query } = await freshConnection();
    await query('SELECT 1');

    // 2000ms turned a brief stall into a hard 500 on every route at once.
    expect(Number(FakePool.instances[0].config.connectionTimeoutMillis)).toBeGreaterThanOrEqual(5000);
  });
});
