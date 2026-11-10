import { describe, it, expect } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';
import { TEST_USER } from '@/__tests__/setup/test-helpers';

/**
 * Merge-mode event import (follow-up to §4.3): when a person or family already
 * exists in the tree, `merge` must import their events (and event-scoped
 * citations) onto the existing record — deduping so re-importing the same file
 * doesn't fork duplicate event rows. Events were previously dropped entirely on
 * the merge-into-existing path.
 */
const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

function gedFile(text: string): File {
  return new File([text], 'family_tree.ged', { type: 'text/plain' });
}

// Person Ida has an OCCU event with a citation; the family has a DIV event with
// a citation. Both partners are present so the family matches on merge.
const GED_FULL = [
  '0 HEAD',
  '0 @I1@ INDI',
  '1 NAME Ida /MergeEvt/',
  '1 OCCU Weaver',
  '2 DATE 1920',
  '2 SOUR @S1@',
  '3 PAGE occ-1',
  '1 FAMS @F1@',
  '0 @I2@ INDI',
  '1 NAME Ivan /MergeEvt/',
  '1 FAMS @F1@',
  '0 @F1@ FAM',
  '1 HUSB @I2@',
  '1 WIFE @I1@',
  '1 DIV',
  '2 DATE 1930',
  '2 SOUR @S1@',
  '3 PAGE div-1',
  '0 @S1@ SOUR',
  '1 TITL MergeEvt Source',
  '0 TRLR',
].join('\n');

async function countEvents(type: string, ownerCol: 'PersonId' | 'FamilyId'): Promise<number> {
  const res = await query(
    `SELECT COUNT(*)::int AS n FROM "Events"
     WHERE "UserId" = $1 AND "Type" = $2 AND "${ownerCol}" IS NOT NULL`,
    [TEST_USER.id, type],
  );
  return res.rows[0].n as number;
}

d('GEDCOM merge-mode event import', () => {
  it('re-importing the same file in merge mode does not duplicate events or their citations', async () => {
    await importGedcomService({ file: gedFile(GED_FULL), mode: 'overwrite', currentUserId: TEST_USER.id });
    await importGedcomService({ file: gedFile(GED_FULL), mode: 'merge', currentUserId: TEST_USER.id });

    // Exactly one OCCU (person) and one DIV (family) event survive the re-merge.
    expect(await countEvents('OCCU', 'PersonId')).toBe(1);
    expect(await countEvents('DIV', 'FamilyId')).toBe(1);

    // Each event still has exactly one citation (insertCitation dedups on merge).
    const cits = await query(
      `SELECT COUNT(*)::int AS n FROM "Citation" c
       JOIN "Events" e ON e."Id" = c."FactId"
       WHERE c."OwnerId" = $1 AND c."FactTable" = 'Events'`,
      [TEST_USER.id],
    );
    expect(cits.rows[0].n).toBe(2);
  });

  it('adds an event to a pre-existing person via merge', async () => {
    const GED_BASE = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME Ida /MergeEvt/',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(GED_BASE), mode: 'overwrite', currentUserId: TEST_USER.id });
    expect(await countEvents('OCCU', 'PersonId')).toBe(0);

    // Same person (@I1@, matched by GedcomId), now carrying an OCCU event.
    const GED_ADD = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME Ida /MergeEvt/',
      '1 OCCU Weaver',
      '2 DATE 1920',
      '2 SOUR @S1@',
      '3 PAGE occ-add',
      '0 @S1@ SOUR',
      '1 TITL Add Source',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(GED_ADD), mode: 'merge', currentUserId: TEST_USER.id });

    expect(await countEvents('OCCU', 'PersonId')).toBe(1);
    const cit = await query(
      `SELECT c."Page" FROM "Citation" c
       JOIN "Events" e ON e."Id" = c."FactId"
       WHERE c."OwnerId" = $1 AND c."FactTable" = 'Events' AND e."Type" = 'OCCU'`,
      [TEST_USER.id],
    );
    expect(cit.rows).toHaveLength(1);
    expect(cit.rows[0].Page).toBe('occ-add');
  });

  it('keeps two same-type/same-date events distinct when their notes differ', async () => {
    const withNote = (note: string) => [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME Ida /MergeEvt/',
      '1 OCCU Village',
      '2 DATE 1925',
      `2 NOTE ${note}`,
      '0 TRLR',
    ].join('\n');

    await importGedcomService({ file: gedFile(withNote('lived by the river')), mode: 'overwrite', currentUserId: TEST_USER.id });
    // Same type + date, different note → must not collapse into the first event.
    await importGedcomService({ file: gedFile(withNote('moved uptown')), mode: 'merge', currentUserId: TEST_USER.id });

    expect(await countEvents('OCCU', 'PersonId')).toBe(2);
  });

  it('does not add a duplicate event when the same-note event is re-merged', async () => {
    const ged = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME Ida /MergeEvt/',
      '1 OCCU Village',
      '2 DATE 1925',
      '2 NOTE lived by the river',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: TEST_USER.id });
    await importGedcomService({ file: gedFile(ged), mode: 'merge', currentUserId: TEST_USER.id });

    expect(await countEvents('OCCU', 'PersonId')).toBe(1);
    // The note was not duplicated onto the reused event either.
    const notes = await query(
      `SELECT COUNT(*)::int AS n FROM "NoteLink" nl
       JOIN "Events" e ON e."Id" = nl."OwnerId"
       WHERE nl."OwnerTable" = 'Events' AND e."UserId" = $1 AND e."Type" = 'OCCU'`,
      [TEST_USER.id],
    );
    expect(notes.rows[0].n).toBe(1);
  });
});
