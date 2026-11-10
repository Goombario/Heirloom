import { Pool } from 'pg';
import { initializeSchema } from '../lib/db/init-schema';

/**
 * Standalone database initialization script for PostgreSQL.
 * Also runs automatically on first query at runtime.
 */

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log('DATABASE_URL not set, skipping database initialization');
    process.exit(0);
  }

  const pool = new Pool({ connectionString });

  console.log('Initializing PostgreSQL database schema...');
  await initializeSchema(pool);
  await pool.end();
  console.log('Database initialization complete!');
}

main().catch((error) => {
  console.error('Database initialization failed:', error);
  process.exit(1);
});
