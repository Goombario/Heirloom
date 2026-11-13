import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';
import { getPlaces, getChildPlaces, getRecordsForPlace } from '@/lib/db/queries/places';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// Dedicated, otherwise-unused user id — integration tests run in parallel.
// Unlike People/Families/Sources (no Users FK), "Places"."UserId" REFERENCES
// "Users", so this suite must create a real Users row for the synthetic id.
const PLACES_USER = 987661;

function gedFile(text: string): File {
  return new File([text], 'family_tree.ged', { type: 'text/plain' });
}

d('Places as a browsable entity (Slice 5)', () => {
  // afterEach deletes the Users row (cascading its Trees), so the default tree
  // must be re-resolved per test — the import stamps this treeId on every row.
  let treeId: number;

  beforeEach(async () => {
    await query(
      `INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)
       ON CONFLICT ("Id") DO NOTHING`,
      [PLACES_USER, `places-test-${PLACES_USER}@example.com`, `places-test-${PLACES_USER}`]
    );
    treeId = await resolveDefaultTree(PLACES_USER);
  });

  afterEach(async () => {
    // Parent self-FK is ON DELETE SET NULL, so a flat delete is safe.
    // Note.OwnerId is the tree owner (this test user); NoteLink cascades from Note.
    await query('DELETE FROM "Note" WHERE "OwnerId" = $1', [PLACES_USER]);
    await query('DELETE FROM "Places" WHERE "UserId" = $1', [PLACES_USER]);
    await query('DELETE FROM "Families" WHERE "UserId" = $1', [PLACES_USER]);
    await query('DELETE FROM "People" WHERE "UserId" = $1', [PLACES_USER]);
    await query('DELETE FROM "Users" WHERE "Id" = $1', [PLACES_USER]);
  });

  it('promotes referenced places to rows with FORM and a jurisdiction hierarchy', async () => {
    const ged = [
      '0 HEAD', '1 PLAC', '2 FORM City, County, State, Country',
      '0 @I1@ INDI', '1 NAME A /B/',
      '1 BIRT', '2 PLAC Boston, Suffolk, Massachusetts, USA',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: PLACES_USER });

    const places = await getPlaces(treeId);
    const names = places.map((p) => p.Name);
    // leaf + every parent segment exist
    expect(names).toContain('Boston, Suffolk, Massachusetts, USA');
    expect(names).toContain('Suffolk, Massachusetts, USA');
    expect(names).toContain('Massachusetts, USA');
    expect(names).toContain('USA');

    const leaf = places.find((p) => p.Name === 'Boston, Suffolk, Massachusetts, USA')!;
    expect(leaf.Form).toBe('City, County, State, Country');

    // hierarchy: leaf's parent is "Suffolk, Massachusetts, USA"
    const parent = places.find((p) => p.Name === 'Suffolk, Massachusetts, USA')!;
    expect(leaf.ParentId).toBe(parent.Id);
    const children = await getChildPlaces(parent.Id, treeId);
    expect(children.map((c) => c.Name)).toContain('Boston, Suffolk, Massachusetts, USA');
    // Each child carries the records at it or below it (the birth in Boston).
    expect(children.find((c) => c.Name === 'Boston, Suffolk, Massachusetts, USA')!.RecordCount).toBeGreaterThanOrEqual(1);
    const country = places.find((p) => p.Name === 'USA')!;
    const states = await getChildPlaces(country.Id, treeId);
    expect(states.find((c) => c.Name === 'Massachusetts, USA')!.RecordCount).toBeGreaterThanOrEqual(1);

    // records-for-place lookup
    const usage = await getRecordsForPlace('Boston, Suffolk, Massachusetts, USA', treeId);
    expect(usage.some((u) => u.kind === 'birth')).toBe(true);
  });

  it('imports a PLAC-level NOTE into the Places-notes model (NoteLink)', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME A /B/',
      '1 BIRT', '2 PLAC Springfield, Illinois',
      '3 NOTE Founded in 1821', '4 CONT and later became the state capital',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: PLACES_USER });

    const places = await getPlaces(treeId);
    const place = places.find((p) => p.Name === 'Springfield, Illinois');
    expect(place).toBeDefined();

    const noteRows = await query(
      `SELECT n."Text" FROM "NoteLink" nl JOIN "Note" n ON n."Id" = nl."NoteId"
       WHERE nl."OwnerTable" = 'Places' AND nl."OwnerId" = $1`,
      [place!.Id],
    );
    expect(noteRows.rows[0]?.Text).toBe('Founded in 1821\nand later became the state capital');
  });

  it('does not duplicate a shared place note when two people reference the same place (round-trip amplification regression)', async () => {
    // Mirrors what the exporter actually emits for a place referenced by
    // multiple records: every occurrence's NOTE is a pointer (`@N1@`) at the
    // SAME shared standalone NOTE record — not independently-authored inline
    // text. This is the exact shape that previously amplified into K duplicate
    // Note rows on import (one per referencing PLAC occurrence).
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME A /B/',
      '1 BIRT', '2 PLAC London, England',
      '3 NOTE @N1@',
      '0 @I2@ INDI', '1 NAME C /D/',
      '1 BIRT', '2 PLAC London, England',
      '3 NOTE @N1@',
      '0 @N1@ NOTE Founded by the Romans',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: PLACES_USER });

    const places = await getPlaces(treeId);
    const place = places.find((p) => p.Name === 'London, England');
    expect(place).toBeDefined();

    const noteRows = await query(
      `SELECT n."Text" FROM "NoteLink" nl JOIN "Note" n ON n."Id" = nl."NoteId"
       WHERE nl."OwnerTable" = 'Places' AND nl."OwnerId" = $1`,
      [place!.Id],
    );
    expect(noteRows.rows).toHaveLength(1);
    expect(noteRows.rows[0]?.Text).toBe('Founded by the Romans');
  });

  it('does not create a place note when no NOTE was present under PLAC', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME No /Note/',
      '1 BIRT', '2 PLAC Quiet Town, Illinois',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: PLACES_USER });

    const places = await getPlaces(treeId);
    const place = places.find((p) => p.Name === 'Quiet Town, Illinois');
    expect(place).toBeDefined();

    const noteRows = await query(
      `SELECT n."Text" FROM "NoteLink" nl JOIN "Note" n ON n."Id" = nl."NoteId"
       WHERE nl."OwnerTable" = 'Places' AND nl."OwnerId" = $1`,
      [place!.Id],
    );
    expect(noteRows.rows).toHaveLength(0);
  });
});
