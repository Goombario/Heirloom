import { type PGliteInterface } from '@electric-sql/pglite';
import { initializeSchema, SCHEMA_VERSION } from './init-schema';

/**
 * Ensure the schema exists and is at the current `SCHEMA_VERSION`, then return.
 *
 * The IndexedDB-backed PGlite VFS flushes to IndexedDB after every statement,
 * so running the full ~80-statement `initializeSchema` on every page hard-load
 * costs ~20s even when every statement is a no-op. Two optimizations:
 *   1. **Gate** — a `_SchemaMeta` row records the version after a successful
 *      init. On a subsequent load two cheap catalog reads (no write) skip the
 *      whole init when the stored version already matches.
 *   2. **One transaction** — when init *does* run (first ever load, or after a
 *      version bump) the statements run inside a single BEGIN..COMMIT, so the
 *      VFS flushes to IndexedDB once at COMMIT instead of ~80 times. This keeps
 *      normal user-write durability unchanged (only this batch is wrapped).
 */
export async function ensureSchema(db: Pick<PGliteInterface, 'query'>): Promise<void> {
  // `to_regclass` returns NULL (it does NOT throw) when "_SchemaMeta" is absent,
  // so a first-ever load falls through to init WITHOUT PGlite logging a
  // "relation does not exist" error to the console. On the warm path both reads
  // are cheap catalog lookups and skip the ~80-statement init.
  const reg = await db.query<{ ok: boolean }>(
    `SELECT to_regclass('"_SchemaMeta"') IS NOT NULL AS ok`
  );
  if (reg.rows[0]?.ok) {
    const v = await db.query<{ v: number }>(`SELECT MAX("Version") AS v FROM "_SchemaMeta"`);
    if ((v.rows[0]?.v ?? -1) >= SCHEMA_VERSION) return;
  }

  await db.query('BEGIN');
  try {
    await initializeSchema({ query: (text, params) => db.query(text, params as unknown[]) });
    await db.query('CREATE TABLE IF NOT EXISTS "_SchemaMeta" ("Version" INTEGER NOT NULL)');
    await db.query('DELETE FROM "_SchemaMeta"');
    await db.query('INSERT INTO "_SchemaMeta" ("Version") VALUES ($1)', [SCHEMA_VERSION]);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  }
}
