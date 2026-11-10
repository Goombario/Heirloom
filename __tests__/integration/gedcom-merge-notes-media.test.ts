import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

/**
 * #492 finding (3) — merge-mode drops notes and media on an EXISTING record.
 *
 * `insertPersonTail` / `insertFamilyTail` own notes + media and were only ever
 * reached from the new-record branch. The merge-into-existing branch handled
 * citations, name variants and events, then `continue`d — so merging a file into
 * a tree that already contained those people silently discarded every note and
 * photo on them. Stable loss, not a race: it was never re-attempted.
 *
 * These assert that a note/photo on an already-present person or family DOES
 * land, while every media occurrence remains local to the current document.
 */
const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

/**
 * Own user + own tree, rather than the shared `TEST_USER` default tree.
 *
 * Integration files run against one database, and several other GEDCOM suites
 * import into TEST_USER's default tree. Sharing it made these assertions pass in
 * isolation and fail in the full run (a neighbouring overwrite landing between
 * this file's import and its assertion). Same reason
 * `gedcom-places-sidecar-merge.test.ts` provisions its own user.
 */
const MERGE_USER = 987664;
let treeId = 0; // assigned in beforeEach; 0 keeps TS's definite-assignment check happy

function gedFile(text: string): File {
  return new File([text], 'family_tree.ged', { type: 'text/plain' });
}

// Person Nora and family F1 each carry a NOTE and an OBJE.
const GED_WITH_NOTES_MEDIA = [
  '0 HEAD',
  '0 @I1@ INDI',
  '1 NAME Nora /MergeNM/',
  '1 NOTE Nora kept the family bible.',
  '1 OBJE',
  '2 FILE nora.jpg',
  '2 TITL Nora portrait',
  '2 FORM jpeg',
  '1 FAMS @F1@',
  '0 @I2@ INDI',
  '1 NAME Ned /MergeNM/',
  '1 FAMS @F1@',
  '0 @F1@ FAM',
  '1 HUSB @I2@',
  '1 WIFE @I1@',
  '1 NOTE The MergeNM wedding was in a barn.',
  '1 OBJE',
  '2 FILE wedding.jpg',
  '2 TITL Wedding day',
  '2 FORM jpeg',
  '0 TRLR',
].join('\n');

// Same people, but the person carries TWO untitled photos. Both occurrences
// must remain distinct within the current document.
const GED_TWO_UNTITLED = [
  '0 HEAD',
  '0 @I1@ INDI',
  '1 NAME Nora /MergeNM/',
  '1 OBJE',
  '2 FILE a.jpg',
  '2 FORM jpeg',
  '1 OBJE',
  '2 FILE b.jpg',
  '2 FORM jpeg',
  '0 TRLR',
].join('\n');

async function personNoteTexts(): Promise<string[]> {
  const res = await query(
    `SELECT n."Text" FROM "Note" n
       JOIN "NoteLink" nl ON nl."NoteId" = n."Id" AND nl."OwnerTable" = 'People'
       JOIN "People" p ON p."Id" = nl."OwnerId"
     WHERE p."UserId" = $1 AND p."LastName" = 'MergeNM' AND p."FirstName" = 'Nora'
     ORDER BY n."Text"`,
    [MERGE_USER],
  );
  return (res.rows as Array<{ Text: string }>).map((r) => r.Text);
}

async function familyNoteTexts(): Promise<string[]> {
  const res = await query(
    `SELECT n."Text" FROM "Note" n
       JOIN "NoteLink" nl ON nl."NoteId" = n."Id" AND nl."OwnerTable" = 'Families'
     WHERE n."OwnerId" = $1 AND n."Text" LIKE '%MergeNM wedding%'
     ORDER BY n."Text"`,
    [MERGE_USER],
  );
  return (res.rows as Array<{ Text: string }>).map((r) => r.Text);
}

async function personMediaTitles(): Promise<Array<string | null>> {
  const res = await query(
    `SELECT m."Title" FROM "Media" m
       JOIN "MediaLink" ml ON ml."MediaId" = m."Id" AND ml."OwnerTable" = 'People'
       JOIN "People" p ON p."Id" = ml."OwnerId"
     WHERE p."UserId" = $1 AND p."LastName" = 'MergeNM' AND p."FirstName" = 'Nora'
     ORDER BY m."Id"`,
    [MERGE_USER],
  );
  return (res.rows as Array<{ Title: string | null }>).map((r) => r.Title);
}

async function familyMediaTitles(): Promise<Array<string | null>> {
  const res = await query(
    `SELECT m."Title" FROM "Media" m
       JOIN "MediaLink" ml ON ml."MediaId" = m."Id" AND ml."OwnerTable" = 'Families'
     WHERE m."UserId" = $1 AND m."Title" = 'Wedding day'
     ORDER BY m."Id"`,
    [MERGE_USER],
  );
  return (res.rows as Array<{ Title: string | null }>).map((r) => r.Title);
}

d('GEDCOM merge-mode: notes and media on an existing record (#492)', () => {
  beforeEach(async () => {
    await query(
      `INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)
       ON CONFLICT ("Id") DO NOTHING`,
      [MERGE_USER, `merge-nm-${MERGE_USER}@example.com`, `merge-nm-${MERGE_USER}`],
    );
    treeId = await resolveDefaultTree(MERGE_USER);
  });

  afterEach(async () => {
    // NoteLink/MediaLink rows go with their Note/Media parents via FK cascade;
    // People/Families must clear before the Users row they reference.
    await query('DELETE FROM "Note" WHERE "OwnerId" = $1', [MERGE_USER]);
    await query('DELETE FROM "Media" WHERE "UserId" = $1', [MERGE_USER]);
    await query('DELETE FROM "Families" WHERE "UserId" = $1', [MERGE_USER]);
    await query('DELETE FROM "People" WHERE "UserId" = $1', [MERGE_USER]);
  });

  it('imports notes and media onto a person and family that already exist', async () => {
    // Seed the tree with the people/family but WITHOUT their notes or media, by
    // importing a stripped file first. The merge then hits the existing-record
    // branch for both.
    const stripped = [
      '0 HEAD',
      '0 @I1@ INDI',
      '1 NAME Nora /MergeNM/',
      '1 FAMS @F1@',
      '0 @I2@ INDI',
      '1 NAME Ned /MergeNM/',
      '1 FAMS @F1@',
      '0 @F1@ FAM',
      '1 HUSB @I2@',
      '1 WIFE @I1@',
      '0 TRLR',
    ].join('\n');

    await importGedcomService({ file: gedFile(stripped), mode: 'overwrite', currentUserId: MERGE_USER, requestedTreeId: treeId });
    expect(await personNoteTexts()).toEqual([]);

    await importGedcomService({ file: gedFile(GED_WITH_NOTES_MEDIA), mode: 'merge', currentUserId: MERGE_USER, requestedTreeId: treeId });

    expect(await personNoteTexts()).toEqual(['Nora kept the family bible.']);
    expect(await familyNoteTexts()).toEqual(['The MergeNM wedding was in a barn.']);
    expect(await personMediaTitles()).toEqual(['Nora portrait']);
    expect(await familyMediaTitles()).toEqual(['Wedding day']);
    const links = await query(
      `SELECT COUNT(*)::int AS c FROM "MediaLink" ml
         JOIN "Media" m ON m."Id" = ml."MediaId" WHERE m."UserId" = $1`,
      [MERGE_USER],
    );
    expect(links.rows[0]).toEqual({ c: 2 });
  });

  it('keeps two distinct untitled photos on the same person', async () => {
    await importGedcomService({ file: gedFile(GED_TWO_UNTITLED), mode: 'overwrite', currentUserId: MERGE_USER, requestedTreeId: treeId });
    expect(await personMediaTitles()).toHaveLength(2);

    await importGedcomService({ file: gedFile(GED_TWO_UNTITLED), mode: 'merge', currentUserId: MERGE_USER, requestedTreeId: treeId });
    expect(await personMediaTitles()).toHaveLength(4);
  });

  it('preserves repeated source inline media occurrences', async () => {
    const stripped = [
      '0 HEAD',
      '0 @S1@ SOUR', '1 TITL Repeated source media',
      '0 TRLR',
    ].join('\n');
    const withTwoMedia = [
      '0 HEAD',
      '0 @S1@ SOUR', '1 TITL Repeated source media',
      '1 OBJE', '2 FILE same.jpg', '2 FORM jpeg', '2 TITL Same scan',
      '1 OBJE', '2 FILE same.jpg', '2 FORM jpeg', '2 TITL Same scan',
      '0 TRLR',
    ].join('\n');

    await importGedcomService({ file: gedFile(stripped), mode: 'overwrite', currentUserId: MERGE_USER, requestedTreeId: treeId });
    await importGedcomService({ file: gedFile(withTwoMedia), mode: 'merge', currentUserId: MERGE_USER, requestedTreeId: treeId });

    const rows = await query(
      `SELECT m."Id" FROM "Media" m
         JOIN "MediaLink" ml ON ml."MediaId" = m."Id" AND ml."OwnerTable" = 'Sources'
         JOIN "Sources" s ON s."Id" = ml."OwnerId"
        WHERE s."OwnerId" = $1 AND s."Title" = 'Repeated source media'
        ORDER BY m."Id"`,
      [MERGE_USER],
    );
    expect(rows.rows).toHaveLength(2);
  });

  it('applies inline media when a merge reuses an existing event', async () => {
    const stripped = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ada /ReusedEvent/', '1 OCCU Blacksmith',
      '0 TRLR',
    ].join('\n');
    const withTwoMedia = [
      '0 HEAD',
      '0 @I1@ INDI', '1 NAME Ada /ReusedEvent/', '1 OCCU Blacksmith',
      '2 OBJE', '3 FILE same.jpg', '3 FORM jpeg', '3 TITL Same scan',
      '2 OBJE', '3 FILE same.jpg', '3 FORM jpeg', '3 TITL Same scan',
      '0 TRLR',
    ].join('\n');

    await importGedcomService({ file: gedFile(stripped), mode: 'overwrite', currentUserId: MERGE_USER, requestedTreeId: treeId });
    await importGedcomService({ file: gedFile(withTwoMedia), mode: 'merge', currentUserId: MERGE_USER, requestedTreeId: treeId });

    const rows = await query(
      `SELECT m."Id" FROM "Media" m
         JOIN "MediaLink" ml ON ml."MediaId" = m."Id" AND ml."OwnerTable" = 'Events'
         JOIN "Events" e ON e."Id" = ml."OwnerId"
        WHERE e."UserId" = $1 AND e."Type" = 'OCCU'
        ORDER BY m."Id"`,
      [MERGE_USER],
    );
    expect(rows.rows).toHaveLength(2);
  });

  // The whole-tree idempotency assertion #492 also names lives in
  // `__tests__/unit/gedcom-merge-idempotent.pglite.test.ts`, not here: `canonicalizeTree`
  // reads through `lib/db/connection.pglite`, so it only works inside the PGlite
  // harness and throws "Worker is not defined" against real Postgres.
});
