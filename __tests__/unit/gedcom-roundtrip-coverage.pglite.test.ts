import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import {
  seedRoundTripFixture, FIXTURE_TREE_ID, type FixtureIds,
} from '../setup/gedcom-roundtrip-fixture';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

/**
 * Every table the exporter reads, with the FROM/JOIN clause and TreeId-scoping
 * WHERE clause used to reach it, plus the alias its own columns are qualified
 * under. Most tables carry "TreeId" directly (alias ''); the polymorphic
 * link/tag/junction tables carry no scope column of their own and are reached
 * through their parent record instead — their alias is what the column-coverage
 * ratchet below qualifies column names with, to avoid ambiguity against the
 * joined parent's columns of the same name (e.g. both "Note" and "NoteLink"
 * have "CreatedAt").
 *
 * Single source of truth for both the presence check (SCOPED_COUNTS, derived
 * below) and the per-column null check in the ratchet at the bottom of this file.
 */
const TABLE_SCOPE: Record<string, { from: string; where: string; alias: string }> = {
  People: { from: '"People"', where: '"TreeId" = $1', alias: '' },
  Families: { from: '"Families"', where: '"TreeId" = $1', alias: '' },
  Events: { from: '"Events"', where: '"TreeId" = $1', alias: '' },
  Sources: { from: '"Sources"', where: '"TreeId" = $1', alias: '' },
  Citation: { from: '"Citation"', where: '"TreeId" = $1', alias: '' },
  Note: { from: '"Note"', where: '"TreeId" = $1', alias: '' },
  NameVariant: { from: '"NameVariant"', where: '"TreeId" = $1', alias: '' },
  Media: { from: '"Media"', where: '"TreeId" = $1', alias: '' },
  Places: { from: '"Places"', where: '"TreeId" = $1', alias: '' },
  Repository: { from: '"Repository"', where: '"TreeId" = $1', alias: '' },
  Cases: { from: '"Cases"', where: '"TreeId" = $1', alias: '' },
  CaseComments: {
    from: '"CaseComments" cc JOIN "Cases" c ON c."Id" = cc."CaseId"',
    where: 'c."TreeId" = $1',
    alias: 'cc',
  },
  CaseMedia: {
    from: '"CaseMedia" cm JOIN "Cases" c ON c."Id" = cm."CaseId"',
    where: 'c."TreeId" = $1',
    alias: 'cm',
  },
  FamilyPerson: {
    from: '"FamilyPerson" fp JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId"',
    where: 'f."TreeId" = $1',
    alias: 'fp',
  },
  NoteLink: {
    from: '"NoteLink" l JOIN "Note" n ON n."Id" = l."NoteId"',
    where: 'n."TreeId" = $1',
    alias: 'l',
  },
  MediaTag: {
    from: '"MediaTag" mt JOIN "Media" m ON m."Id" = mt."MediaId"',
    where: 'm."TreeId" = $1',
    alias: 'mt',
  },
  MediaLink: {
    from: '"MediaLink" ml JOIN "Media" m ON m."Id" = ml."MediaId"',
    where: 'm."TreeId" = $1',
    alias: 'ml',
  },
};

const SCOPED_COUNTS: Array<[table: string, sql: string]> = Object.entries(TABLE_SCOPE).map(
  ([table, s]) => [table, `SELECT COUNT(*)::int AS n FROM ${s.from} WHERE ${s.where}`],
);

describe('round-trip fixture', () => {
  let mdb: PGlite;
  let ids: FixtureIds;
  beforeAll(async () => {
    mdb = await newEmptyClusterDb();
    __setTestDb(mdb);
    await query('SELECT 1'); // triggers the lazy schema init gate
    ids = await seedRoundTripFixture(mdb);
  });
  afterAll(async () => { __setTestDb(null); await mdb.close(); });

  it('seeds every table the exporter reads', async () => {
    for (const [table, sql] of SCOPED_COUNTS) {
      const r = await query(sql, [FIXTURE_TREE_ID]);
      expect((r.rows[0] as { n: number }).n, `${table} is empty in the fixture tree`)
        .toBeGreaterThan(0);
    }
  });

  it('seeds the hostile shapes the round-trip tests depend on', async () => {
    // Stored / null / duplicate GedcomId trio.
    const gedcomIds = await query(
      'SELECT "GedcomId" FROM "People" WHERE "TreeId" = $1 ORDER BY "Id"', [FIXTURE_TREE_ID],
    );
    const values = (gedcomIds.rows as { GedcomId: string | null }[]).map(r => r.GedcomId);
    expect(values).toContain(null);
    expect(values.filter(v => v === '@I9@')).toHaveLength(2);

    // Library media (no canonical owner) and two rows sharing a basename.
    const media = await query(
      'SELECT "FilePath" FROM "Media" WHERE "TreeId" = $1',
      [FIXTURE_TREE_ID],
    );
    const mediaRows = media.rows as { FilePath: string | null }[];
    const ownerless = await query(
      `SELECT COUNT(*)::int AS n FROM "Media" m
        WHERE m."TreeId" = $1
          AND NOT EXISTS (SELECT 1 FROM "MediaLink" ml WHERE ml."MediaId" = m."Id")`,
      [FIXTURE_TREE_ID],
    );
    expect(ownerless.rows[0].n).toBe(1);
    expect(mediaRows.filter(m => m.FilePath?.split(/[\\/]/).pop() === 'portrait.jpg')).toHaveLength(2);

    const shared = await query(
      `SELECT m."Id", m."FocalX", m."FocalY", m."FocalRadius", l."OwnerTable", l."IsPrimary"
         FROM "Media" m JOIN "MediaLink" l ON l."MediaId" = m."Id"
        WHERE m."TreeId" = $1 AND m."Title" = 'Shared all-owner photo'
        ORDER BY l."OwnerTable"`, [FIXTURE_TREE_ID],
    );
    expect(shared.rows).toHaveLength(4);
    expect((shared.rows as Array<{ OwnerTable: string }>).map(r => r.OwnerTable))
      .toEqual(['Events', 'Families', 'People', 'Sources']);
    expect((shared.rows as Array<{ IsPrimary: number }>).filter(r => r.IsPrimary === 1)).toHaveLength(1);

    const primaryLinks = await query(
      `SELECT l."OwnerId", COUNT(*)::int AS n
         FROM "MediaLink" l JOIN "Media" m ON m."Id" = l."MediaId"
        WHERE m."TreeId" = $1 AND l."OwnerTable" = 'People' AND l."IsPrimary" = 1
        GROUP BY l."OwnerId" ORDER BY l."OwnerId"`, [FIXTURE_TREE_ID],
    );
    expect(primaryLinks.rows).toHaveLength(2);
    expect((primaryLinks.rows as Array<{ n: number }>).every(r => r.n === 1)).toBe(true);
    const taggedPrimary = await query(
      `SELECT COUNT(*)::int AS n FROM "MediaTag" mt JOIN "Media" m ON m."Id" = mt."MediaId"
        WHERE m."TreeId" = $1 AND m."Title" = 'Portrait'`, [FIXTURE_TREE_ID],
    );
    expect(taggedPrimary.rows[0].n).toBe(1);

    const geometry = await query(
      `SELECT "Title", "FocalX", "FocalY", "FocalRadius"
         FROM "Media" WHERE "TreeId" = $1 AND "FilePath" LIKE '%portrait.jpg'
        ORDER BY "Title"`, [FIXTURE_TREE_ID],
    );
    expect(geometry.rows).toEqual([
      { Title: 'Portrait', FocalX: 20, FocalY: 30, FocalRadius: 25 },
      { Title: 'Same basename', FocalX: 65, FocalY: 75, FocalRadius: 35 },
    ]);

    const mediaLinks = await query(
      `SELECT "OwnerTable" FROM "MediaLink" ml JOIN "Media" m ON m."Id" = ml."MediaId"
       WHERE m."TreeId" = $1`, [FIXTURE_TREE_ID],
    );
    expect((mediaLinks.rows as { OwnerTable: string }[]).map(r => r.OwnerTable)).toContain('Families');

    // The canonical primary's face tag points at its canonical People owner.
    const tag = await query(
      `SELECT mt."PersonId" AS "TagPersonId", ml."OwnerId" AS "OwnerPersonId", ml."IsPrimary" AS "OwnerPrimary"
       FROM "MediaTag" mt
       JOIN "Media" m ON m."Id" = mt."MediaId"
       JOIN "MediaLink" ml ON ml."MediaId" = mt."MediaId"
        AND ml."OwnerTable" = 'People' AND ml."IsPrimary" = 1
       WHERE m."TreeId" = $1`,
      [FIXTURE_TREE_ID],
    );
    const tagRow = tag.rows[0] as { TagPersonId: number; OwnerPrimary: number; OwnerPersonId: number };
    expect(tagRow.TagPersonId).toBe(tagRow.OwnerPersonId);
    expect(tagRow.OwnerPrimary).toBe(1);

    // Citations span the .ged / sidecar fact-table split.
    const facts = await query(
      'SELECT "FactTable" FROM "Citation" WHERE "TreeId" = $1', [FIXTURE_TREE_ID],
    );
    // Two People rows: the plain whole-person citation and the one carrying the
    // SOURCE_CITATION evidence block (QUAY / EVEN+ROLE / DATA.DATE+DATA.TEXT).
    // NameVariant rides in both the .ged and sources.json (#963). Two Events rows:
    // the whole-event citation and the one of its DATE (#990). A journal entry's
    // citation rides in cases.json (#1035).
    expect((facts.rows as { FactTable: string }[]).map(r => r.FactTable).sort())
      .toEqual(['CaseComments', 'Cases', 'Events', 'Events', 'Families', 'FamilyMarriage', 'NameVariant', 'People', 'People', 'PersonBirth', 'PersonDeath', 'PersonName']);

    // Exactly one primary name variant, plus a non-primary one.
    const variants = await query(
      'SELECT "IsPrimary" FROM "NameVariant" WHERE "TreeId" = $1', [FIXTURE_TREE_ID],
    );
    const flags = (variants.rows as { IsPrimary: number }[]).map(r => r.IsPrimary);
    expect(flags.filter(f => f === 1)).toHaveLength(1);
    expect(flags.filter(f => f === 0)).toHaveLength(1);

    // A childless family and a person in no family at all. Asserted against THAT
    // family rather than by counting childless families across the tree — the
    // shape is what matters, and a count breaks every time another family is
    // seeded for an unrelated reason.
    const childless = await query(
      `SELECT COUNT(*)::int AS n FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $1`,
      [ids.familyIds.childless],
    );
    expect((childless.rows[0] as { n: number }).n).toBe(0);
    const unattached = await query(
      `SELECT COUNT(*)::int AS n FROM "People" p
       WHERE p."TreeId" = $1
         AND NOT EXISTS (SELECT 1 FROM "Families" f WHERE f."HusbandId" = p."Id" OR f."WifeId" = p."Id")
         AND NOT EXISTS (SELECT 1 FROM "FamilyPerson" fp WHERE fp."ChildrenId" = p."Id")`,
      [FIXTURE_TREE_ID],
    );
    expect((unattached.rows[0] as { n: number }).n).toBe(1);

    // Place hierarchy with coordinates and a FORM. The fixture seeds the FULL
    // comma-segment chain since #402 (so the importer's promotion pass derives
    // nothing new), which means several rows have parents — assert the specific
    // edges rather than whichever row an unordered query returns first.
    const place = await query(
      `SELECT c."Name", c."Form", c."Latitude", p."Name" AS "ParentName"
       FROM "Places" c JOIN "Places" p ON p."Id" = c."ParentId" WHERE c."TreeId" = $1`,
      [FIXTURE_TREE_ID],
    );
    const byName = new Map(
      (place.rows as Array<{ Name: string; Form: string | null; Latitude: number | null; ParentName: string }>)
        .map((r) => [r.Name, r]),
    );
    expect(byName.get('Paris, Île-de-France, France'))
      .toMatchObject({ Form: 'City', ParentName: 'Île-de-France, France' });
    expect(byName.get('Île-de-France, France')).toMatchObject({ ParentName: 'France' });
    expect(byName.get('Montréal, Québec, Canada')).toMatchObject({ ParentName: 'Québec, Canada' });
    expect(byName.get('Paris, Île-de-France, France')?.Latitude).toBeCloseTo(48.8566);

    // Unicode and a literal @ survive the insert (the escaping hazard). This used
    // to read People."Notes"; that column is gone (#524 / ADR 0010), so the hazard
    // is carried by the person's first-class note.
    const raw = await query(
      'SELECT "RawGedcom" FROM "People" WHERE "Id" = $1', [ids.personIds.stored],
    );
    expect((raw.rows[0] as { RawGedcom: string }).RawGedcom).toContain(`1 ASSO @~I:${ids.personIds.orphan}@`);

    const personNote = await query(
      `SELECT n."Text" FROM "Note" n
         JOIN "NoteLink" l ON l."NoteId" = n."Id"
        WHERE l."OwnerTable" = 'People' AND l."OwnerId" = $1`,
      [ids.personIds.stored],
    );
    const noteText = (personNote.rows[0] as { Text: string }).Text;
    expect(noteText).toContain('@');
    expect(noteText).toContain('café');
  });
});

/**
 * Columns the fixture deliberately leaves null. Adding a row here is a conscious
 * statement that the column does NOT round-trip through GEDCOM. Adding a column
 * to one of these tables without touching this list fails the test — which is
 * the whole point.
 *
 * Column lists below are verified against `lib/db/init-schema.ts` (schema
 * version 31), not copied from an earlier draft.
 *
 * SCOPE — every exporter-read table listed in `SCOPED_COUNTS`/`TABLE_SCOPE`
 * above (except `MediaLink`, tracked separately) has a column-level ratchet
 * keyed below: a new nullable column on any of them, left null in the fixture,
 * fails this test. A column with a non-null DEFAULT is a known blind spot — see
 * the comment inside the loop below — so it can pass here without anyone having
 * judged whether it round-trips; that gap is documented, not hidden.
 */
const NOT_ROUND_TRIPPED: Record<string, string[]> = {
  // Surrogate key, owner/scope columns, and audit timestamps — never part of a
  // GEDCOM INDI record.
  // The place ids (#1167) are surrogate keys too: the text they spell round-trips
  // as PLAC (ADR 0037), and import matches the place from it again.
  People: ['Id', 'UserId', 'TreeId', 'UpdatedAt', 'CreatedAt', 'BirthPlaceId', 'DeathPlaceId', 'BirthPlaceNameId', 'DeathPlaceNameId'],
  // Same as People. Families has no "CreatedAt" column (only "UpdatedAt").
  Families: ['Id', 'UserId', 'TreeId', 'UpdatedAt', 'MarriagePlaceId', 'MarriagePlaceNameId'],
  // Events has neither "CreatedAt" nor "UpdatedAt" in the schema.
  Events: ['Id', 'UserId', 'TreeId', 'PlaceId', 'PlaceNameId'],
  Sources: [
    'Id', 'OwnerId', 'TreeId',
  ],
  NameVariant: [
    'Id', 'OwnerId', 'TreeId', 'CreatedAt',
    // PERSONAL_NAME_STRUCTURE (GEDCOM Specs/extracted/ged551-2.txt:632-641) has
    // no date sub-structure: NAME carries TYPE, name pieces, FONE and ROMN only
    // — there is no FROM/TO tag for the period a name variant was used, so
    // these columns genuinely cannot round-trip through GEDCOM 5.5.1.
    'FromDate', 'ToDate',
  ],
  Cases: ['Id', 'UserId', 'TreeId', 'CreatedAt', 'UpdatedAt'],
  Citation: [
    'Id', 'OwnerId', 'TreeId', 'CreatedAt',
    // NOT 'Note' — Citation."Note" IS emitted (generator.ts pushCitations:
    // `2 NOTE <text>` under the SOURCE_CITATION), so it is seeded in the
    // fixture rather than exempted here.
  ],
  Note: [
    'Id', 'OwnerId', 'TreeId', 'CreatedAt',
    // Set exclusively by the one-time People."Notes" -> Note/NoteLink backfill
    // in init-schema.ts (#524 / ADR 0010), the same pattern as
    // Sources."MigratedFromCaseCitationId" above. Internal migration bookkeeping
    // only — no GEDCOM tag reads or writes it, and a fresh row created by the
    // app (or by this fixture) never sets it.
    'BackfilledFromPersonId',
    // FINDING, by design: ADR 0015 ("Note @Nn@ labels are minted on emission,
    // never on lookup") makes the imported xref import-only. `xrefForNote` mints
    // a fresh `@Nn@` label at first-reference order every time a tree is
    // exported, and `lib/services/gedcom-export.ts` strips "GedcomXref" before
    // handing notes to the generator (`notes: allNotes.map(n => ({ Id, Text,
    // BackfilledFromPersonId }))`) — `GedcomExportNote` in generator.ts does not
    // even declare the field. So the column is genuinely lossy on export, not
    // merely unexercised: it is populated in this fixture only because an
    // unrelated shared-note case (`{ xref: '@N_SHARED@' }`) happens to set it.
    'GedcomXref',
  ],
  // NoteLink has no "Id" (its key is NoteId+OwnerTable+OwnerId). NoteId/
  // OwnerTable/OwnerId are NOT NULL structural columns always populated by any
  // insert, and OwnerFact/IsPrimary are exercised/trivially non-null already —
  // only the audit timestamp needs an exemption.
  NoteLink: ['CreatedAt'],
  Media: [
    'Id', 'UserId', 'TreeId',
    // FINDING: genuinely lossy. "FileSize" is app-internal storage-quota
    // bookkeeping (lib/db/queries/media.ts getStorageUsedForTree) — it is
    // selected by the exporter's `SELECT *` (lib/db/queries/gedcom-export.ts)
    // but neither the .ged OBJE emit nor media.json's library-media sidecar
    // (lib/gedcom/media-sidecar.ts) carries it. It is also NOT NULL DEFAULT 0,
    // so it would pass this ratchet trivially either way — listed anyway so the
    // gap is documented rather than silently relying on the default-value blind
    // spot.
    'FileSize',
    // NOT a loss: "ContentHash" is derived from the uploaded bytes, not authored
    // data, and GEDCOM 5.5.1 has no tag for it (MULTIMEDIA_LINK carries FILE,
    // FORM and TITL only). Round-tripping it would also be wrong — an import
    // materializes each photo through `materializeImportMediaService`, which recomputes
    // the hash from the bytes actually received. Carrying a stale hash across a
    // round trip could claim a match for bytes the tree no longer holds (#592).
    'ContentHash',
    // Operational idempotency key for one upload attempt. It is scoped to the
    // destination tree and intentionally must not survive GEDCOM export/import:
    // replay identity is meaningful only while retrying the original upload.
    'UploadIntentId',
    // Operational create-time replay identity; deliberately excluded from
    // GEDCOM because it is not authored genealogy data.
    'UploadIntentTarget',
  ],
  // MediaTag has no "TreeId"/owner column of its own (scoped through Media);
  // MediaId/PersonId are NOT NULL FKs always populated, and Region* geometry
  // are all exercised by the fixture's face tag. "CreatedAt" is the same
  // audit-timestamp shape every other entry exempts (matches its sibling
  // junction table NoteLink's ['CreatedAt']).
  MediaTag: ['Id', 'CreatedAt'],
  Places: [
    'Id', 'UserId', 'TreeId', 'CreatedAt', 'UpdatedAt',
  ],
  Repository: ['Id', 'OwnerId', 'TreeId', 'CreatedAt'],
  // FamilyPerson has no "Id"/"TreeId"/owner column at all (scoped through
  // Families). FamiliesAsChildId/ChildrenId are the NOT NULL composite key,
  // always populated, and the two relationship columns round-trip via the CHILD's
  // `2 PEDI` or the family's `2 _FREL` / `2 _MREL` (generator.ts,
  // childLinkRelationshipLines). Nothing in this table needs an exemption.
  FamilyPerson: [],
};

describe('fixture column coverage ratchet', () => {
  let mdb: PGlite;
  beforeAll(async () => {
    mdb = await newEmptyClusterDb();
    __setTestDb(mdb);
    await query('SELECT 1'); // triggers the lazy schema init gate
    await seedRoundTripFixture(mdb);
  });
  afterAll(async () => { __setTestDb(null); await mdb.close(); });

  for (const [table, exempt] of Object.entries(NOT_ROUND_TRIPPED)) {
    it(`populates every round-tripped column of ${table}`, async () => {
      const cols = await query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1 AND table_schema = 'public'`, [table],
      );
      const scope = TABLE_SCOPE[table];
      const unpopulated: string[] = [];
      for (const { column_name } of cols.rows as { column_name: string }[]) {
        if (exempt.includes(column_name)) continue;
        // The signal is purely "non-null somewhere in the fixture tree". A new
        // column carrying a non-null DEFAULT is therefore populated the moment
        // it is added and passes this ratchet WITHOUT anyone deciding whether it
        // round-trips — the ratchet forces a decision only for nullable columns.
        // Populating a column also proves nothing on its own: it only counts as
        // coverage if `gedcom-canonical.ts` selects and compares it too.
        //
        // Scoped via TABLE_SCOPE, not a bare `WHERE "TreeId" = $1`: three tables
        // (NoteLink, MediaTag, FamilyPerson) have no "TreeId" of their own and
        // are reached through their parent's join instead. The column is
        // qualified with the table's own alias so it can never resolve
        // ambiguously against the joined parent's column of the same name.
        const colRef = scope.alias ? `${scope.alias}."${column_name}"` : `"${column_name}"`;
        const r = await query(
          `SELECT COUNT(*)::int AS n FROM ${scope.from}
           WHERE ${scope.where} AND ${colRef} IS NOT NULL`, [FIXTURE_TREE_ID],
        );
        if ((r.rows[0] as { n: number }).n === 0) unpopulated.push(column_name);
      }
      expect(
        unpopulated,
        `${table}: these columns are null for every fixture row, so nothing proves they ` +
        `round-trip. Populate them in gedcom-roundtrip-fixture.ts, or add them to ` +
        `NOT_ROUND_TRIPPED with a comment saying why.`,
      ).toEqual([]);
    });
  }
});
