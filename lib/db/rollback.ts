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
