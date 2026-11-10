import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

describe('Events owner XOR constraint', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('SELECT 1');
  });

  afterAll(async () => {
    __setTestDb(null);
    await db.close();
  });

  it('rejects an event with neither owner', async () => {
    await expect(query(
      `INSERT INTO "Events" ("UserId", "TreeId", "Type", "PersonId", "FamilyId")
       VALUES (1, 1, 'TEST', NULL, NULL)`,
    )).rejects.toThrow();
  });

  it('rejects an event with both owners', async () => {
    await expect(query(
      `INSERT INTO "Events" ("UserId", "TreeId", "Type", "PersonId", "FamilyId")
       VALUES (1, 1, 'TEST', 10, 20)`,
    )).rejects.toThrow();
  });

  it('accepts exactly one owner', async () => {
    await expect(query(
      `INSERT INTO "Events" ("UserId", "TreeId", "Type", "PersonId", "FamilyId")
       VALUES (1, 1, 'TEST_PERSON', 10, NULL)`,
    )).resolves.toBeDefined();
    await expect(query(
      `INSERT INTO "Events" ("UserId", "TreeId", "Type", "PersonId", "FamilyId")
       VALUES (1, 1, 'TEST_FAMILY', NULL, 20)`,
    )).resolves.toBeDefined();
  });
});
