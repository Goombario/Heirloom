import type { PGliteInterface } from '@electric-sql/pglite';

/**
 * Reset every data table between tests WITHOUT re-booting PGlite or re-running
 * the ~80-statement schema init. Truncates all public tables except
 * `_SchemaMeta` (which records the schema version — clearing it would force a
 * costly re-init on the next query). `RESTART IDENTITY` resets serial sequences
 * so each test sees ids starting at 1; `CASCADE` handles FK dependencies so the
 * caller never has to order the table list.
 *
 * Discovering the table list from `pg_tables` (rather than hardcoding it) keeps
 * this correct as the schema grows.
 */
export async function truncateAllTables(db: PGliteInterface): Promise<void> {
  const { rows } = await db.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_SchemaMeta'`
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await db.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
