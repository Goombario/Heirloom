import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { sortableYear } from '@/lib/date-utils';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * The specification of the year-extraction rule, in one list. `"SortableYear"`
 * in SQL and `sortableYear` in TypeScript must agree on every entry (#490,
 * ADR 0016). Adding a stored date shape to the app means adding a row here.
 */
const CASES: string[] = [
  '1850', '1850-03', '1850-03-15',
  'ABT 1850', 'EST 1850', 'CAL 1850', 'BEF 1920', 'AFT 1850', 'INT 1850',
  'BET 1850 AND 1855',
  'FROM 1850 TO 1880',
  'FROM 1850',
  'TO 1880',
  '(sometime in the 1850s)',
  '(abt 1850)',
  '()',
  'BET the fire AND 1855',
  'BET 1850',
  'ABT',
  'no digits at all',
  '',
  '   ',
  '26 AUG 1819',
];

describe('SortableYear: SQL mirrors TypeScript', () => {
  let mdb: PGlite;
  beforeAll(async () => {
    mdb = await newEmptyClusterDb();
    __setTestDb(mdb);
    await query('SELECT 1'); // triggers the lazy schema init gate
  });
  afterAll(async () => { __setTestDb(null); await mdb.close(); });

  it.each(CASES)('agrees on %j', async (value) => {
    const r = await query('SELECT "SortableYear"($1) AS y', [value]);
    const sql = (r.rows[0] as { y: number | null }).y;
    expect(sql, `SQL disagrees with sortableYear() for ${JSON.stringify(value)}`)
      .toBe(sortableYear(value));
  });

  it('returns null for a NULL date', async () => {
    const r = await query('SELECT "SortableYear"(NULL) AS y');
    expect((r.rows[0] as { y: number | null }).y).toBeNull();
  });
});
