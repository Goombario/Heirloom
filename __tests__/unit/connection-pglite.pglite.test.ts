import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, getClient, __setTestDb } from '@/lib/db/connection.pglite';
import { truncateAllTables } from '../setup/pglite-truncate';

let db: PGlite;

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('SELECT 1'); // boot WASM + run schema init ONCE for the whole file
});

beforeEach(async () => {
  await truncateAllTables(db);
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

describe('connection.pglite query()', () => {
  it('initializes the schema and runs a parameterized query', async () => {
    const res = await query('SELECT COUNT(*)::int AS c FROM "People"');
    expect(res.rows[0]).toEqual({ c: 0 });
    expect(res.rowCount).toBe(1);
  });

  it('maps affectedRows to rowCount for writes', async () => {
    await query(
      'INSERT INTO "Users" ("Email", "Name", "GoogleId") VALUES ($1, $2, $3)',
      ['a@b', 'A', 'g1']
    );
    const del = await query('DELETE FROM "Users" WHERE "GoogleId" = $1', ['g1']);
    expect(del.rowCount).toBe(1);
  });
});

describe('connection.pglite getClient() transactions', () => {
  it('commits work done on a client', async () => {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO "Users" ("Email", "Name", "GoogleId") VALUES ($1, $2, $3)',
        ['tx@b', 'Tx', 'g-commit']
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const res = await query('SELECT "Id" FROM "Users" WHERE "GoogleId" = $1', ['g-commit']);
    expect(res.rows.length).toBe(1);
  });

  it('discards work on ROLLBACK', async () => {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO "Users" ("Email", "Name", "GoogleId") VALUES ($1, $2, $3)',
        ['rb@b', 'Rb', 'g-rollback']
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const res = await query('SELECT "Id" FROM "Users" WHERE "GoogleId" = $1', ['g-rollback']);
    expect(res.rows.length).toBe(0);
  });
});
