import { describe, it, expect } from 'vitest';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

describe('PGlite schema compatibility', () => {
  it('builds the full schema in an in-memory PGlite database', async () => {
    const db = await newEmptyClusterDb(); // in-memory (no persistence path)
    const executor: DbExecutor = {
      query: (text, params) => db.query(text, params),
    };

    // Should not throw — this exercises every CREATE TABLE/INDEX statement.
    await initializeSchema(executor);

    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'`
    );
    const tables = result.rows.map((r) => r.table_name);

    // Core tables the rest of the app depends on must exist.
    for (const expected of ['Users', 'People', 'Families', 'FamilyPerson']) {
      expect(tables).toContain(expected);
    }

    await db.close();
  });
});
