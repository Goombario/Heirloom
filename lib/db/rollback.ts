import type { PoolClient } from 'pg';
import { getClient } from '@/lib/db/connection';

/**
 * Roll back a transaction without letting the ROLLBACK itself mask the error
 * that aborted it. On a dead connection `client.query('ROLLBACK')` throws too —
 * swallowing that keeps the original failure as the one the caller rethrows.
 * Use this in every `catch` of a `BEGIN … COMMIT` block; a bare
 * `await client.query('ROLLBACK')` in a catch is a bug.
 */
export async function safeRollback(client: { query: (sql: string) => Promise<unknown> }): Promise<void> {
    try {
        await client.query('ROLLBACK');
    } catch {
        /* keep the original error */
    }
}

/**
 * Run `fn` on one pooled client inside BEGIN … COMMIT, rolling back on any
 * error. For query functions whose statements must land together (#51, L-14).
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await safeRollback(client);
        throw err;
    } finally {
        client.release();
    }
}
