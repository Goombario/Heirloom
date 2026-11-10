import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

import { LocalDataClient } from '@/lib/data/local';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { initializeSchema } from '@/lib/db/init-schema';

/**
 * #789 / #727: PGlite reports the host zone as a FIXED offset (Etc/GMT+5 on a
 * Toronto host), so NOW() into a zone-less TIMESTAMP stored EST wall time, and
 * the driver read it back as UTC: an hour off in DST, five hours off here.
 */
let db: PGlite;

// The driver reads a zone-less TIMESTAMP in the host zone, so the fixed session
// zone must differ from the host's current offset or the pre-migration skew is 0
// (an EST host in winter, #1267). getTimezoneOffset() is minutes west of UTC.
const hostHoursWest = new Date().getTimezoneOffset() / 60;
const sessionZone = Math.abs(hostHoursWest - 5) < 1 ? 'Etc/GMT+8' : 'Etc/GMT+5';

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('SELECT 1');
  await db.exec(`SET TimeZone = '${sessionZone}'`);
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

const nearNow = (value: unknown) => Math.abs(new Date(value as string).getTime() - Date.now());

describe('case timestamps on PGlite (#789)', () => {
  it('converts rows written into the old zone-less columns to the instant they were written', async () => {
    const client = new LocalDataClient();
    const created = await client.cases.create({ Title: 'Written before the migration' });
    // Recreate the pre-#789 column and a row as the old default wrote it.
    await db.exec(`ALTER TABLE "Cases" ALTER COLUMN "CreatedAt" TYPE TIMESTAMP USING "CreatedAt" AT TIME ZONE 'UTC'`);
    await db.query(`UPDATE "Cases" SET "CreatedAt" = NOW()::timestamp WHERE "Id" = $1`, [created.Id]);
    const before = await db.query<{ CreatedAt: Date }>(`SELECT "CreatedAt" FROM "Cases" WHERE "Id" = $1`, [created.Id]);
    // Off by the gap between the fixed offset and the zone the driver reads it in:
    // an hour on an EDT host, five on a UTC one, three on an EST one (Etc/GMT+8).
    expect(nearNow(before.rows[0].CreatedAt)).toBeGreaterThan(30 * 60_000);

    await initializeSchema({ query: (text, params) => db.query(text, params as unknown[]) });

    const type = await db.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'Cases' AND column_name = 'CreatedAt'`,
    );
    expect(type.rows[0].data_type).toBe('timestamp with time zone');
    const after = await db.query<{ CreatedAt: Date }>(`SELECT "CreatedAt" FROM "Cases" WHERE "Id" = $1`, [created.Id]);
    expect(nearNow(after.rows[0].CreatedAt)).toBeLessThan(60_000);
  });

  it('reads a case created now as now, whatever the session zone', async () => {
    const created = await new LocalDataClient().cases.create({ Title: 'Written after the migration' });
    expect(nearNow(created.CreatedAt)).toBeLessThan(60_000);
    expect(nearNow(created.UpdatedAt)).toBeLessThan(60_000);
  });
});
