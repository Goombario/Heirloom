import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { plannerStatsAreStale, refreshPlannerStatsIfStale } from '@/lib/db/planner-stats';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * #1268: PGlite has no autovacuum, so an imported tree was never analyzed and
 * the planner costed every table at a couple of dozen rows. Imports now refresh
 * the statistics, and the database's open checks them.
 */
const USER_ID = 991_269;

const reltuples = async () =>
  Number(((await query(`SELECT reltuples::float8 AS n FROM pg_class WHERE oid = '"People"'::regclass`)).rows[0] as { n: number }).n);

describe('planner statistics', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [USER_ID, 'stats@test.local', 'stats']);
    await resolveDefaultTree(USER_ID);
  });

  afterAll(async () => {
    __setTestDb(null);
    await db?.close();
  });

  it('counts as stale only past 500 people and when never analyzed or off by half', () => {
    expect(plannerStatsAreStale(-1, 499)).toBe(false);
    expect(plannerStatsAreStale(-1, 500)).toBe(true);
    expect(plannerStatsAreStale(1000, 1500)).toBe(false);
    expect(plannerStatsAreStale(1000, 2001)).toBe(true);
    expect(plannerStatsAreStale(2000, 999)).toBe(true);
  });

  it('a GEDCOM import leaves People analyzed', async () => {
    expect(await reltuples()).toBe(-1);
    const ged = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '0 @I1@ INDI', '1 NAME Ada /Whitcombe/', '0 @I2@ INDI', '1 NAME Ben /Whitcombe/', '0 TRLR'].join('\n');
    const file = new File([ged], 'tiny.ged', { type: 'text/plain' });
    await importGedcomService({ file, mode: 'overwrite', currentUserId: USER_ID });
    expect(await reltuples()).toBe(2);
  });

  it('refreshPlannerStatsIfStale analyzes only when the counts have moved', async () => {
    const run = vi.fn((text: string) => query(text));
    expect(await refreshPlannerStatsIfStale(run)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);

    const stale = vi.fn(async (text: string) => text.startsWith('ANALYZE')
      ? { rows: [] }
      : { rows: [{ reltuples: -1, people: 4834 }] });
    expect(await refreshPlannerStatsIfStale(stale)).toBe(true);
    expect(stale).toHaveBeenLastCalledWith(expect.stringMatching(/^ANALYZE "People"/));
  });
});
