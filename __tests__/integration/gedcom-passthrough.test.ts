import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// Use a dedicated, otherwise-unused user id so this test is fully isolated from the
// shared test users. Integration tests run in PARALLEL against one Postgres, and
// importing under TEST_USER would race with suites that assert that user's counts
// (e.g. stats.test.ts expects 0 people for user1). There is no FK on UserId/OwnerId,
// so a synthetic id is safe; afterEach removes everything this suite creates.
const PASSTHROUGH_USER = 987654;

function gedFile(text: string): File {
  return new File([text], 'family_tree.ged', { type: 'text/plain' });
}

// Slice 0p: the importer preserves unmodeled subtrees in <Record>.RawGedcom so an
// import -> export -> re-import round-trip is lossless. This verifies the persistence half
// (the generator emission is unit-tested in gedcom-generator.test.ts).
d('GEDCOM passthrough persistence', () => {
  // Multi-tree: the import resolves this user's default tree, and "Trees"
  // FK's "Users" — so the synthetic user id needs a real Users row.
  beforeAll(async () => {
    await query(
      'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3) ON CONFLICT ("Id") DO NOTHING',
      [PASSTHROUGH_USER, `gedcom-passthrough-${PASSTHROUGH_USER}@test.local`, `google-${PASSTHROUGH_USER}`],
    );
  });

  afterEach(async () => {
    await query('DELETE FROM "Sources" WHERE "OwnerId" = $1', [PASSTHROUGH_USER]);
    // "Events" has no FK to "People"/"Families" (init-schema.ts:135-145), so nothing
    // cascades — without this the rows leak into the next test in this file.
    await query('DELETE FROM "Events" WHERE "UserId" = $1', [PASSTHROUGH_USER]);
    await query('DELETE FROM "Families" WHERE "UserId" = $1', [PASSTHROUGH_USER]);
    await query('DELETE FROM "People" WHERE "UserId" = $1', [PASSTHROUGH_USER]);
  });

  it('stores unmodeled INDI subtrees in People.RawGedcom', async () => {
    const ged = [
      '0 HEAD', '0 @I1@ INDI', '1 NAME Raw /Passthrough/',
      '1 TITL Sir', '1 ASSO @I2@', '2 RELA Godfather',
      '0 @I2@ INDI', '1 NAME God /Father/', '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: PASSTHROUGH_USER });
    const r = await query(
      'SELECT "RawGedcom" FROM "People" WHERE "UserId" = $1 AND "FirstName" = $2',
      [PASSTHROUGH_USER, 'Raw']
    );
    const raw = (r.rows[0] as { RawGedcom: string | null } | undefined)?.RawGedcom;
    expect(raw).toContain('1 TITL Sir');
    // The kept pointer is stored as the godfather's id (#979).
    const godfather = await query('SELECT "Id" FROM "People" WHERE "UserId" = $1 AND "FirstName" = $2', [PASSTHROUGH_USER, 'God']);
    expect(raw).toContain(`1 ASSO @~I:${(godfather.rows[0] as { Id: number }).Id}@\n2 RELA Godfather`);
  });

  // #525: "RawGedcom" was on importEvent's inline INSERT (gedcom.ts:379) but missing
  // from flushEvents' batched column list, and flushEvents IS the overwrite path — the
  // mode a full re-import uses. So the common case silently dropped every event's
  // passthrough while the merge path preserved it, which is exactly why the existing
  // coverage stayed green. Asserted on OVERWRITE specifically for that reason.
  it('stores unmodeled event subtrees in Events.RawGedcom on the overwrite path (#525)', async () => {
    const ged = [
      '0 HEAD', '0 @I1@ INDI', '1 NAME Ev /Passthrough/',
      // AGNC is not in HANDLED_COLUMN_EVENT_L2 (parser.ts:172), so it is captured
      // into the event's own rawLines rather than the record-level ones.
      '1 RESI', '2 DATE 1930', '2 PLAC Montréal', '2 AGNC Ville de Montréal',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: PASSTHROUGH_USER });
    const r = await query(
      'SELECT "RawGedcom" FROM "Events" WHERE "UserId" = $1 AND "Type" = $2',
      [PASSTHROUGH_USER, 'RESI']
    );
    expect(r.rows).toHaveLength(1);
    expect((r.rows[0] as { RawGedcom: string | null }).RawGedcom).toContain('2 AGNC Ville de Montréal');
  });

  it('reports preserved + skipped counts in the import summary (§4.2)', async () => {
    const ged = [
      '0 HEAD',
      // Person with an unmodeled subtree → preserved via RawGedcom.
      '0 @I1@ INDI', '1 NAME Raw /Passthrough/', '1 ASSO @I2@', '2 RELA Godfather',
      '0 @I2@ INDI', '1 NAME God /Father/',
      // Family referencing a child that is NOT defined in the file → skipped link.
      '0 @F1@ FAM', '1 HUSB @I1@', '1 CHIL @IMISSING@',
      '0 TRLR',
    ].join('\n');
    const result = await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: PASSTHROUGH_USER });
    expect(result.preservedCount).toBeGreaterThanOrEqual(1);
    expect(result.skippedCount).toBe(1);
  });

  it('stores unmodeled FAM subtrees in Families.RawGedcom', async () => {
    const ged = [
      '0 HEAD', '0 @I1@ INDI', '1 NAME H /X/', '0 @F1@ FAM', '1 HUSB @I1@',
      '1 SLGS', '2 DATE 1899', '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: PASSTHROUGH_USER });
    const r = await query(
      'SELECT "RawGedcom" FROM "Families" WHERE "UserId" = $1 ORDER BY "Id" DESC LIMIT 1',
      [PASSTHROUGH_USER]
    );
    // SLGS (LDS spouse sealing) is unmodeled — it must survive as passthrough. ENGA is
    // now a real family event (imported into Events), so it would no longer land here.
    expect((r.rows[0] as { RawGedcom: string | null } | undefined)?.RawGedcom).toContain('1 SLGS');
  });
});
