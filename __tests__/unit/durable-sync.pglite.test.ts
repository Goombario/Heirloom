import { describe, it, expect, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { DURABLE_FLUSH_CHANNEL, withDurableSync } from '@/lib/db/durable-sync';

// The worker's RPC layer calls syncToFs() on this proxy after each page query (#1008).
let db: PGlite | null = null;
afterEach(async () => { await db?.close(); db = null; });

async function setup() {
  db = new PGlite();
  const flushes: string[] = [];
  const gates: Array<(error?: Error) => void> = [];
  const proxied = withDurableSync(db, () => new Promise<void>((resolve, reject) => {
    const n = gates.length + 1;
    flushes.push(`start ${n}`);
    gates.push((error) => { flushes.push(`end ${n}`); if (error) reject(error); else resolve(); });
  }));
  await proxied.waitReady;
  await proxied.query('SELECT 1'); // the LISTEN is registered by now
  return { proxied, flushes, gates };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('withDurableSync (#1008)', () => {
  it('leaves an ordinary query relaxed', async () => {
    const { proxied, flushes } = await setup();
    await proxied.query('SELECT 1');
    await proxied.syncToFs();
    expect(flushes).toEqual([]);
  });

  it('makes the sync after a durable-flush request wait for the full flush', async () => {
    const { proxied, flushes, gates } = await setup();
    await proxied.query(`NOTIFY ${DURABLE_FLUSH_CHANNEL}`);
    expect(flushes).toEqual(['start 1']);
    let synced = false;
    const sync = proxied.syncToFs().then(() => { synced = true; });
    await tick();
    expect(synced).toBe(false);
    gates[0]();
    await sync;
    expect(flushes).toEqual(['start 1', 'end 1']);
  });

  it('starts a new flush for a request made while one is running, and waits for that one', async () => {
    const { proxied, flushes, gates } = await setup();
    await proxied.query(`NOTIFY ${DURABLE_FLUSH_CHANNEL}`);
    await proxied.query(`NOTIFY ${DURABLE_FLUSH_CHANNEL}`);
    expect(flushes).toEqual(['start 1', 'start 2']);
    let synced = false;
    const sync = proxied.syncToFs().then(() => { synced = true; });
    gates[0]();
    await tick();
    expect(synced).toBe(false);
    gates[1]();
    await sync;
  });

  it('rejects the waiting sync when the flush fails, so the import does not report success', async () => {
    const { proxied, gates } = await setup();
    await proxied.query(`NOTIFY ${DURABLE_FLUSH_CHANNEL}`);
    const sync = proxied.syncToFs();
    gates[0](new Error('quota exceeded'));
    await expect(sync).rejects.toThrow('quota exceeded');
  });

  it('waitForDurableFlush starts no flush of its own (#1277)', async () => {
    const { proxied, flushes } = await setup();
    const own = vi.spyOn(db!, 'syncToFs');
    await proxied.query('SELECT 1');
    own.mockClear();
    await proxied.waitForDurableFlush();
    expect(own).not.toHaveBeenCalled();
    expect(flushes).toEqual([]);
  });

  it('waitForDurableFlush waits for a durable flush the statement asked for, and rejects when it fails', async () => {
    const { proxied, gates } = await setup();
    await proxied.query(`NOTIFY ${DURABLE_FLUSH_CHANNEL}`);
    let settled = false;
    const wait = proxied.waitForDurableFlush().finally(() => { settled = true; });
    await tick();
    expect(settled).toBe(false);
    gates[0](new Error('quota exceeded'));
    await expect(wait).rejects.toThrow('quota exceeded');
  });

  it('keeps PGlite private state working through the proxy', async () => {
    const { proxied } = await setup();
    const { rows } = await proxied.query<{ n: number }>('SELECT 41 + 1 AS n');
    expect(rows[0].n).toBe(42);
    expect(proxied.isInTransaction()).toBe(false);
  });
});
