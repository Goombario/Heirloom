import { describe, it, expect } from 'vitest';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

// The Phase-2 migration backfills the retired Families.EndedDate/EndedReason columns
// into divorce/annulment/separation Events, then drops the columns. Because it is
// guarded on column existence, re-adding the columns + data and re-running
// initializeSchema exercises the exact production migration path against real column
// data (which the drop otherwise makes impossible to seed after init).

describe('family ended-column → events backfill (Phase 2)', () => {
  it('converts column endings to Events, skips Death, dedups, and drops the columns', async () => {
    const db = await newEmptyClusterDb();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await initializeSchema(executor); // first run drops the columns

    // Recreate the pre-migration shape and seed legacy column data.
    await db.query(`ALTER TABLE "Families" ADD COLUMN "EndedDate" TEXT`);
    await db.query(`ALTER TABLE "Families" ADD COLUMN "EndedReason" TEXT`);
    await db.query(`INSERT INTO "Families" ("Id","UserId","EndedReason","EndedDate") VALUES (1, 7, 'Divorce', '1984')`);
    await db.query(`INSERT INTO "Families" ("Id","UserId","EndedReason","EndedDate") VALUES (2, 7, 'Annulment', NULL)`);
    await db.query(`INSERT INTO "Families" ("Id","UserId","EndedReason","EndedDate") VALUES (3, 7, 'Separation', '1990')`);
    await db.query(`INSERT INTO "Families" ("Id","UserId","EndedReason","EndedDate") VALUES (4, 7, 'Death', '1960')`);
    // Family 5 already has a DIV event — the backfill must not double it.
    await db.query(`INSERT INTO "Families" ("Id","UserId","EndedReason","EndedDate") VALUES (5, 7, 'Divorce', '2000')`);
    await db.query(`INSERT INTO "Events" ("UserId","Type","Date","FamilyId") VALUES (7, 'DIV', '2000', 5)`);
    // Family 6: an 'Unknown'-cause ending collapses to SEPA so it stays "ended".
    await db.query(`INSERT INTO "Families" ("Id","UserId","EndedReason","EndedDate") VALUES (6, 7, 'Unknown', '1975')`);

    await initializeSchema(executor); // second run: guard sees the columns → backfill + drop

    const events = await db.query<{ Type: string; Date: string | null; FamilyId: number }>(
      `SELECT "Type", "Date", "FamilyId" FROM "Events" ORDER BY "FamilyId", "Id"`,
    );
    const byFamily = (fid: number) => events.rows.filter((e) => e.FamilyId === fid);

    expect(byFamily(1)).toEqual([{ Type: 'DIV', Date: '1984', FamilyId: 1 }]);
    expect(byFamily(2)).toEqual([{ Type: 'ANUL', Date: null, FamilyId: 2 }]);
    expect(byFamily(3)).toEqual([{ Type: 'SEPA', Date: '1990', FamilyId: 3 }]);
    expect(byFamily(4)).toEqual([]); // Death is derived, never an event
    expect(byFamily(5)).toEqual([{ Type: 'DIV', Date: '2000', FamilyId: 5 }]); // not doubled
    expect(byFamily(6)).toEqual([{ Type: 'SEPA', Date: '1975', FamilyId: 6 }]); // Unknown → SEPA

    // Columns are gone again.
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Families'`,
    );
    const names = cols.rows.map((c) => c.column_name);
    expect(names).not.toContain('EndedReason');
    expect(names).not.toContain('EndedDate');

    await db.close();
  });
});
