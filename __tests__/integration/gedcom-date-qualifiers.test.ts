import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// Dedicated, otherwise-unused user id — integration tests run in parallel.
const DATE_USER = 987660;

function gedFile(text: string): File {
  return new File([text], 'family_tree.ged', { type: 'text/plain' });
}

d('Date qualifiers preserved on import (GED-4)', () => {
  // Multi-tree: the import resolves this user's default tree, and "Trees"
  // FK's "Users" — so the synthetic user id needs a real Users row.
  beforeAll(async () => {
    await query(
      'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3) ON CONFLICT ("Id") DO NOTHING',
      [DATE_USER, `gedcom-date-qualifiers-${DATE_USER}@test.local`, `google-${DATE_USER}`],
    );
  });

  afterEach(async () => {
    await query('DELETE FROM "People" WHERE "UserId" = $1', [DATE_USER]);
  });

  it('stores an approximate birth date and a between death date instead of dropping them', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME A /B/',
      '1 BIRT', '2 DATE ABT 1850',
      '1 DEAT', '2 DATE BET 1900 AND 1905',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: DATE_USER });

    const r = await query(
      'SELECT "BirthDate", "DeathDate" FROM "People" WHERE "UserId" = $1 LIMIT 1',
      [DATE_USER]
    );
    expect(r.rows[0]).toMatchObject({ BirthDate: 'ABT 1850', DeathDate: 'BET 1900 AND 1905' });
  });
});
