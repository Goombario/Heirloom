import { Pool } from 'pg';

/**
 * Ad-hoc SQL runner for inspecting a live database.
 *
 *   npm run db:query -- 'SELECT "Id", "TreeId" FROM "People" LIMIT 5'
 *
 * Reads DATABASE_URL from `.env.local` (see the npm script). To inspect the
 * throwaway test database instead:
 *
 *   npm run db:query:test -- 'SELECT count(*) FROM "People"'
 *
 * Read-only by default. This connects to real, personal family data, so a
 * statement that is not a plain SELECT/WITH/EXPLAIN is refused unless you pass
 * --write explicitly. That guard is the whole point of the script existing:
 * it exists so inspection never needs an inline `node -e`, and inspection
 * should not be able to mutate anything by accident.
 */

const WRITE_FLAG = '--write';

function isReadOnly(sql: string): boolean {
  // Strip leading comments and whitespace before classifying.
  const stripped = sql.replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)+/, '');
  return /^(select|with|explain|show|table)\b/i.test(stripped);
}

async function main() {
  const args = process.argv.slice(2);
  const allowWrite = args.includes(WRITE_FLAG);
  const sql = args.filter((a) => a !== WRITE_FLAG).join(' ').trim();

  if (!sql) {
    console.error('Usage: npm run db:query -- \'<SQL>\'  [--write]');
    process.exit(1);
  }

  if (!allowWrite && !isReadOnly(sql)) {
    console.error(
      'Refused: this looks like a write. Re-run with --write if you mean it.\n' +
      'This connects to real family data — writes should be deliberate.'
    );
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Check the env file the npm script points at.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  try {
    const result = await pool.query(sql);
    if (Array.isArray(result.rows) && result.rows.length > 0) {
      console.table(result.rows);
      console.log(`(${result.rowCount} row${result.rowCount === 1 ? '' : 's'})`);
    } else {
      console.log(`(no rows; rowCount=${result.rowCount})`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
