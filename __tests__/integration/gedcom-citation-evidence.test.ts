import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// Dedicated, otherwise-unused user id — integration tests run in parallel against
// one Postgres, so this keeps the suite isolated (see gedcom-passthrough.test.ts).
const EVIDENCE_USER = 987657;

function gedFile(text: string): File {
  return new File([text], 'family_tree.ged', { type: 'text/plain' });
}

d('Citation evidence fields (Slice 3)', () => {
  // Multi-tree: the import resolves this user's default tree, and "Trees"
  // FK's "Users" — so the synthetic user id needs a real Users row.
  beforeAll(async () => {
    await query(
      'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3) ON CONFLICT ("Id") DO NOTHING',
      [EVIDENCE_USER, `gedcom-citation-evidence-${EVIDENCE_USER}@test.local`, `google-${EVIDENCE_USER}`],
    );
  });

  afterEach(async () => {
    await query('DELETE FROM "Citation" WHERE "OwnerId" = $1', [EVIDENCE_USER]);
    await query('DELETE FROM "Sources" WHERE "OwnerId" = $1', [EVIDENCE_USER]);
    await query('DELETE FROM "People" WHERE "UserId" = $1', [EVIDENCE_USER]);
  });

  it('imports QUAY / DATA / EVEN+ROLE on a person citation', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME A /B/',
      '1 SOUR @S1@',
      '2 PAGE p. 42',
      '2 EVEN BIRT', '3 ROLE CHIL',
      '2 DATA', '3 DATE 3 MAR 1900', '3 TEXT born at home',
      '2 QUAY 3',
      '0 @S1@ SOUR', '1 TITL Register',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: EVIDENCE_USER });

    const r = await query(
      `SELECT "Page", "Quay", "DataText", "DataDate", "Even", "Role"
       FROM "Citation" WHERE "OwnerId" = $1 LIMIT 1`,
      [EVIDENCE_USER]
    );
    expect(r.rows[0]).toMatchObject({
      Page: 'p. 42', Quay: '3', DataText: 'born at home', DataDate: '3 MAR 1900',
      Even: 'BIRT', Role: 'CHIL',
    });
  });
});
