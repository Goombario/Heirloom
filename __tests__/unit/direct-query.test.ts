import { describe, expect, it, vi } from 'vitest';
import { directQueryClient, serveDirectQueries, type DirectQueryDb } from '@/lib/db/direct-query';

/** A page and its worker, joined the way postMessage joins them (cloned, async). */
function pair() {
  const page = new EventTarget();
  const scope = new EventTarget();
  const deliver = (to: EventTarget, data: unknown) =>
    queueMicrotask(() => to.dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })));
  const worker = Object.assign(page, { postMessage: (data: unknown) => deliver(scope, data) }) as unknown as Worker;
  const workerScope = Object.assign(scope, { postMessage: (data: unknown) => deliver(page, data) }) as unknown as DedicatedWorkerGlobalScope;
  return { worker, workerScope };
}

function fakeDb(overrides: Partial<DirectQueryDb> = {}): DirectQueryDb {
  return {
    query: vi.fn(async () => ({ rows: [{ Id: 1 }], affectedRows: 0 })),
    waitForDurableFlush: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('direct worker queries', () => {
  it('runs the statement in the worker, then waits for a durable flush it asked for', async () => {
    const { worker, workerScope } = pair();
    const order: string[] = [];
    const db = fakeDb({
      query: vi.fn(async () => { order.push('query'); return { rows: [{ Id: 7 }], affectedRows: 0 }; }),
      waitForDurableFlush: vi.fn(async () => { order.push('sync'); }),
    });
    serveDirectQueries(workerScope, Promise.resolve(db));
    const client = directQueryClient(worker);

    await expect(client.query('SELECT $1', [7])).resolves.toEqual({ rows: [{ Id: 7 }], affectedRows: 0 });
    expect(db.query).toHaveBeenCalledWith('SELECT $1', [7]);
    expect(order).toEqual(['query', 'sync']);
  });

  it('keeps the fields callers read from a database error', async () => {
    const { worker, workerScope } = pair();
    const failure = Object.assign(new Error('duplicate key value'), { code: '23505', detail: 'Key exists', query: 'INSERT', params: [{ big: 1 }] });
    serveDirectQueries(workerScope, Promise.resolve(fakeDb({ query: vi.fn(async () => { throw failure; }) })));
    const client = directQueryClient(worker);

    const err = await client.query('INSERT').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ message: 'duplicate key value', code: '23505', detail: 'Key exists', query: 'INSERT' });
    expect((err as { params?: unknown }).params).toBeUndefined();
  });

  it('keeps a DOMException code, which lives on the prototype', async () => {
    const { worker, workerScope } = pair();
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    serveDirectQueries(workerScope, Promise.resolve(fakeDb({ waitForDurableFlush: vi.fn(async () => { throw quota; }) })));
    const client = directQueryClient(worker);

    await expect(client.query('INSERT')).rejects.toMatchObject({ name: 'QuotaExceededError', code: 22 });
  });

  it('settles the call when the reply cannot be cloned', async () => {
    const { worker, workerScope } = pair();
    const post = workerScope.postMessage.bind(workerScope);
    let first = true;
    (workerScope as unknown as { postMessage: (d: unknown) => void }).postMessage = (data: unknown) => {
      if (first) { first = false; throw new DOMException('could not be cloned', 'DataCloneError'); }
      post(data);
    };
    serveDirectQueries(workerScope, Promise.resolve(fakeDb()));
    const client = directQueryClient(worker);

    await expect(client.query('SELECT 1')).rejects.toMatchObject({ name: 'DataCloneError' });
  });

  it('matches replies to their calls when several are in flight', async () => {
    const { worker, workerScope } = pair();
    serveDirectQueries(workerScope, Promise.resolve(fakeDb({
      query: vi.fn(async (text: string) => {
        if (text === 'slow') await new Promise((r) => setTimeout(r, 5));
        return { rows: [{ text }] };
      }),
    })));
    const client = directQueryClient(worker);

    const [slow, fast] = await Promise.all([client.query('slow'), client.query('fast')]);
    expect(slow.rows).toEqual([{ text: 'slow' }]);
    expect(fast.rows).toEqual([{ text: 'fast' }]);
  });

  it('rejects calls still in flight when closed', async () => {
    const { worker, workerScope } = pair();
    serveDirectQueries(workerScope, new Promise<DirectQueryDb>(() => {}));
    const client = directQueryClient(worker);

    const pending = client.query('SELECT 1');
    client.close();
    await expect(pending).rejects.toThrow('closed');
  });
});
