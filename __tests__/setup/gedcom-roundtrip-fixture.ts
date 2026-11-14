import type { PGlite } from '@electric-sql/pglite';
import { insertRecord } from './fact-places';

/**
 * One tree carrying every data shape the GEDCOM exporter touches, chosen to be
 * hostile rather than representative. Consumed by the gedcom-roundtrip-*.test.ts
 * files.
 *
 * Each shape below exists to break something specific:
 *   - stored `GedcomId` alongside a null one  → index-vs-stored xref divergence
 *   - two people sharing a `GedcomId`         → the `usable()` fallback path
 *   - `RawGedcom` with a pointer               → unmodeled subtrees, `@@`→`@`
 *   - library media (`PersonId` null)          → `media.json.libraryMedia`
 *   - face tag on a non-owner person           → `media.json.tags` person xref
 *   - two media sharing a basename             → basename-keyed sidecar matching
 *   - NameVariant with/without `IsPrimary`     → the IsPrimary invisibility trap
 *   - Cases + linked people + structured citations → cases.json sidecar pointers
 *   - non-person MediaLink                      → inline family OBJE ownership
 *   - childless family + spouseless person     → empty-collection relation edges
 *   - citations across four fact tables        → the GEDCOM_FACT_TABLES split
 *   - notes at person/event/family scope       → level-1/level-2 NOTE scope reset
 *   - place hierarchy + coords + Form          → `PLAC.MAP` / `FORM` emission
 *   - Unicode and a literal `@` in text        → BOM handling and `@@` escaping
 *
 * All data is fictional. A dedicated user/tree id keeps this isolated from the
 * shared test users.
 *
 * GENERAL RULE: where two channels *can independently* supply the same field
 * (e.g. a sidecar and a .ged tag that both carry it), seed them with
 * DIFFERENT values, or a pass that overwrites one channel with the other
 * changes nothing observable and the fixture cannot see a clobber.
 *
 * That rule does NOT apply to the gazetteer's coordinates. `places.json` and
 * the `.ged`'s `PLAC.MAP` are not independent channels here: both are read
 * straight off the same `"Places"."Latitude"`/`"Longitude"` columns of the
 * same row at export time (`lib/gedcom/places-sidecar.ts`'s
 * `buildPlacesSidecar` and `lib/services/places.ts`'s
 * `getPlaceCoordsForUser`), with no rounding or transform in between — so for
 * any values seeded here they are numerically identical on every export, by
 * construction. There is no way to make them disagree by changing `mkPlace`'s
 * arguments, and forcing an artificial disagreement (e.g. a hand-authored
 * duplicate `PLAC.MAP` via `RawGedcom`) breaks this suite's own byte-identical
 * `.ged` fixed point once the correct precedence converges on one value.
 * The `COALESCE(existing, incoming)` precedence fixed for #402 (see the
 * comments at its two upserts in `lib/services/gedcom.ts`) IS pinned by a
 * real, disagreement-driven regression test — just not this one (verified by
 * attempting it here: no seeding of `mkPlace` can make the two channels
 * disagree, because both read the same columns of the same row, and forcing a
 * disagreement through `RawGedcom` breaks this suite's byte-identical `.ged`
 * fixed point instead of testing precedence):
 * `__tests__/integration/gedcom-places-sidecar-merge.test.ts`'s
 * `GED_WITH_PLACE_COORDS` fixture hand-authors a `.ged` that disagrees with a
 * curated tree, and `it('keeps a curated coordinate when the .ged PLAC.MAP
 * disagrees', ...)` fails if that precedence is reverted (verified directly:
 * reverting the fix there fails 2/11 tests in that file). If you're tempted
 * to retry the round-trip-fixture approach for this field, don't.
 */
export const FIXTURE_USER_ID = 4242;
export const FIXTURE_TREE_ID = 4242;

export interface FixtureIds {
  userId: number;
  treeId: number;
  personIds: Record<string, number>;
  familyIds: Record<string, number>;
  caseIds: Record<string, number>;
  sourceId: number;
  mediaIds: Record<string, number>;
}

/** Optional People columns a hostile person row may carry. */
interface PersonExtras {
  BirthDate?: string;
  BirthPlace?: string;
  DeathDate?: string;
  DeathPlace?: string;
  DeathCause?: string;
  IsDeceased?: boolean;
  RawGedcom?: string;
  BirthRawGedcom?: string;
  DeathRawGedcom?: string;
  NameRawGedcom?: string;
}

export async function seedRoundTripFixture(db: PGlite): Promise<FixtureIds> {
  const U = FIXTURE_USER_ID;
  const T = FIXTURE_TREE_ID;

  await db.query(
    'INSERT INTO "Users" ("Id","Email","GoogleId") VALUES ($1,$2,$3) ON CONFLICT ("Id") DO NOTHING',
    [U, 'roundtrip@test.local', 'google-roundtrip'],
  );
  await db.query(
    'INSERT INTO "Trees" ("Id","OwnerId","Name") VALUES ($1,$2,$3) ON CONFLICT ("Id") DO NOTHING',
    [T, U, 'Round-Trip Fixture'],
  );

  const personIds: Record<string, number> = {};
  const insertPerson = async (
    key: string, first: string, last: string, sex: string,
    gedcomId: string | null, extra: PersonExtras = {},
  ) => {
    // "IsDeceased" is INTEGER in the schema, not BOOLEAN.
    const { Id } = await insertRecord(db, 'People', {
      UserId: U, TreeId: T, FirstName: first, LastName: last, Sex: sex, GedcomId: gedcomId,
      BirthDate: extra.BirthDate ?? null, BirthPlace: extra.BirthPlace ?? null,
      DeathDate: extra.DeathDate ?? null, DeathPlace: extra.DeathPlace ?? null, DeathCause: extra.DeathCause ?? null,
      IsDeceased: extra.IsDeceased ? 1 : 0, RawGedcom: extra.RawGedcom ?? null,
      BirthRawGedcom: extra.BirthRawGedcom ?? null, DeathRawGedcom: extra.DeathRawGedcom ?? null, NameRawGedcom: extra.NameRawGedcom ?? null,
    });
    personIds[key] = Id;
    return Id;
  };

  // Stored GedcomId + full vitals + a pointer-bearing raw passthrough block.
  const stored = await insertPerson('stored', 'Élodie', "O'Brien-Smith", 'F', '@I7@', {
    BirthDate: '1901-01-15', BirthPlace: 'Paris, Île-de-France, France',
    DeathDate: '1984-06-02', DeathPlace: 'Montréal, Québec, Canada',
    IsDeceased: true,
    // The ASSO pointer is set below, once the person it names exists.
    RawGedcom: '1 TITL Dame',
    DeathCause: 'Heart failure',
    // DEAT sub-tag the parser still does not model (#423) — must re-emit nested
    // under "1 DEAT", not dangling at the end of the record.
    DeathRawGedcom: '2 AGNC County archive',
    // NAME pieces the app doesn't model ride under the primary `1 NAME` (#964).
    NameRawGedcom: '2 NPFX Dr\n2 NSFX PhD',
  });
  // No stored GedcomId — forces a fresh xref alongside the stored ones.
  const fresh = await insertPerson('fresh', 'John', 'Doe', 'M', null, {
    BirthDate: '1899-03-04', IsDeceased: true,
    // BIRT sub-tag the parser doesn't model (#423).
    BirthRawGedcom: '2 AGNC Hôtel-Dieu de Paris',
  });
  // Duplicate GedcomId pair — both must fall back to distinct fresh xrefs.
  await insertPerson('dupeA', 'Dup', 'Alpha', 'M', '@I9@');
  await insertPerson('dupeB', 'Dup', 'Beta', 'F', '@I9@');
  // Spouseless, childless, event-less: the empty-collection edge.
  const orphan = await insertPerson('orphan', 'Solo', 'Unattached', 'U', '@I11@');
  // A passthrough pointer is stored as the record's id, which export rewrites to
  // that record's xref (#979).
  await db.query('UPDATE "People" SET "RawGedcom" = $1 WHERE "Id" = $2', [`1 ASSO @~I:${orphan}@\n2 RELA Godparent\n1 TITL Dame`, stored]);
  const child = await insertPerson('child', 'Marie', "O'Brien-Smith", 'F', '@I12@', {
    BirthDate: '1925-11-30',
  });

  // Families keep BOTH the legacy Husband/Wife columns (which the export groups
  // spouse families on) and the Partner1/Partner2 columns the app now writes.
  const familyIds: Record<string, number> = {};
  const insertFamily = async (
    p1: number, p2: number, marriageDate: string, marriagePlace: string | null,
    rawGedcom: string | null = null, marriageRawGedcom: string | null = null,
  ) => {
    const { Id } = await insertRecord(db, 'Families', {
      UserId: U, TreeId: T, HusbandId: p1, WifeId: p2, Partner1Id: p1, Partner2Id: p2,
      MarriageDate: marriageDate, MarriagePlace: marriagePlace, Type: 'Marriage', RawGedcom: rawGedcom, MarriageRawGedcom: marriageRawGedcom,
    });
    return Id;
  };
  // RawGedcom: unmodeled passthrough subtree, same purpose as People.RawGedcom.
  // MarriageRawGedcom: a MARR sub-tag the parser doesn't model (#423) — must
  // re-emit nested under "1 MARR", not dangling at record end like RawGedcom above.
  familyIds.married = await insertFamily(
    fresh, stored, '1924-05-01', 'Paris, Île-de-France, France',
    '1 _UID F-ROUNDTRIP-1', '2 AGNC Mairie de Paris',
  );
  // Partner1RawGedcom / Partner2RawGedcom: Legacy's preferred-spouse flag under
  // each partner's "1 HUSB" / "1 WIFE" (#989).
  await db.query(
    `UPDATE "Families" SET "Partner1RawGedcom" = '2 _PREF Y', "Partner2RawGedcom" = '2 _PREF N' WHERE "Id" = $1`,
    [familyIds.married],
  );
  // FamcRawGedcom: a PEDI with no type plus an unmodeled FAMC sub-tag (#954) —
  // must re-emit under this child's own "1 FAMC" line.
  await db.query(
    'INSERT INTO "FamilyPerson" ("FamiliesAsChildId","ChildrenId","Partner1Relationship","Partner2Relationship","FamcRawGedcom") VALUES ($1,$2,$3,$3,$4)',
    [familyIds.married, child, 'Birth', '2 PEDI sealing\n2 STAT proven'],
  );
  // A blended-family link (#982): adopted by Partner1, Partner2's birth child, so
  // export writes FTM's `_FREL Adopted` / `_MREL Natural` under its "1 CHIL" and
  // re-import sets each partner from them. ChilRawGedcom: a sub-line the app
  // doesn't model (#961), which rides back after them.
  await db.query(
    'INSERT INTO "FamilyPerson" ("FamiliesAsChildId","ChildrenId","Partner1Relationship","Partner2Relationship","ChilRawGedcom") VALUES ($1,$2,$3,$4,$5)',
    [familyIds.married, personIds.dupeA, 'Adoption', 'Birth', '2 _PREF Y'],
  );
  // Childless family — no FamilyPerson rows at all.
  familyIds.childless = await insertFamily(personIds.dupeA, personIds.dupeB, '1950-02-02', null);
  // Born, nothing more known: a bare `1 BIRT Y` on export (#968).
  await db.query(`UPDATE "People" SET "BirthRecorded" = 1 WHERE "Id" = $1`, [personIds.dupeB]);
  // Married, nothing more known: a bare `1 MARR Y` on export (#965).
  await db.query(`UPDATE "Families" SET "MarriageDate" = NULL, "MarriageRecorded" = 1 WHERE "Id" = $1`, [familyIds.childless]);

  // Person event + family event.
  // RawGedcom: an event sub-tag the parser doesn't model (#423) — must re-emit
  // nested under this specific event's own "1 RESI" line, not any other event's.
  const { Id: eventId } = await insertRecord(db, 'Events', {
    UserId: U, TreeId: T, PersonId: stored, Type: 'RESI', Date: '1930-01-01', Place: 'Montréal, Québec, Canada',
    Description: 'Lived on rue Saint-Denis', RawGedcom: '2 AGNC Ville de Montréal',
  });
  // Custom person event: Type is not a standard GEDCOM tag, so it must emit as
  // `1 EVEN` + `2 TYPE <label>` and come back with the label intact (ADR 0012).
  await insertRecord(db, 'Events', { UserId: U, TreeId: T, PersonId: stored, Type: 'Land Lease', Date: '1837-10-02', Place: null });
  const famEvt = await insertRecord(db, 'Events', {
    UserId: U, TreeId: T, FamilyId: familyIds.married, Type: 'DIV', Date: '1960-08-09', Place: 'Montréal, Québec, Canada',
  });

  // A family whose Type is not 'Marriage' exercises the `_FTYPE` emit/import
  // branch, and its SEPA event is a NON-STANDARD family event, which rides
  // `1 EVEN` + `2 TYPE SEPA` rather than a tag of its own.
  familyIds.commonLaw = await insertFamily(child, personIds.dupeB, '1955-03-03', null);
  await db.query(`UPDATE "Families" SET "Type" = 'Common-law' WHERE "Id" = $1`, [familyIds.commonLaw]);
  await db.query(
    `INSERT INTO "Events" ("UserId","TreeId","FamilyId","Type","Date") VALUES ($1,$2,$3,$4,$5)`,
    [U, T, familyIds.commonLaw, 'SEPA', '1958-04-04'],
  );

  // Source + repository + citations spanning the .ged / sidecar split. The
  // source's free-text "RepositoryName" is what the export joins the Repository
  // row's address on, so the two names must match.
  const REPO_NAME = 'Archives nationales';
  // Text -> GEDCOM _URL, Contents -> SOUR.TEXT (transcription),
  // Num -> _NUM, RepositoryMedi -> CALN.MEDI, RawGedcom -> unmodeled passthrough —
  // all real generator/parser mappings (lib/gedcom/generator.ts), so all must be
  // populated for the coverage ratchet to prove they round-trip.
  const src = await db.query<{ Id: number }>(
    `INSERT INTO "Sources"
     ("OwnerId","TreeId","Title","Author","PublicationInfo","RepositoryName","CallNumber","Type",
      "Text","Contents","Num","RepositoryMedi","RawGedcom","Abbreviation")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING "Id"`,
    [U, T, 'Parish Register of Saint-Sulpice', 'Diocese of Paris', '1900-1910',
     REPO_NAME, 'AN/1900/42', 'Document',
     'https://archives.example/records/1900-42', 'Transcribed register entry, line 1.\nLine two.',
     42, 'Microfilm', '1 _UID S-ROUNDTRIP-1',
     // #501 — `1 ABBR`, the short filing title. Non-ASCII on purpose: this channel
     // is one of the few carrying an accented value through the export escaping.
     'Saint-Sulpice, reg. paroissial'],
  );
  const sourceId = src.rows[0].Id;
  const repo = await db.query<{ Id: number }>(
    `INSERT INTO "Repository" ("OwnerId","TreeId","Name","Address","RawGedcom","AddressRawGedcom","Website","Phone","Email")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING "Id"`,
    // A REPO's unmodeled lines and its ADDR's structured lines ride back (#966), and
    // so do its first website, phone and email (ADR 0049); a second phone stays raw.
    [U, T, REPO_NAME, '59 rue Guynemer, Pierrefitte-sur-Seine',
     '1 PHON +33 1 11 11 11 11', '2 CITY Pierrefitte-sur-Seine\n2 CTRY France',
     'https://archives.example', '+33 1 00 00 00 00', 'contact@archives.example'],
  );
  await db.query('UPDATE "Sources" SET "RepositoryId" = $1 WHERE "Id" = $2', [repo.rows[0].Id, sourceId]);

  const cite = async (factTable: string, factId: number, page: string, note: string | null = null) =>
    db.query(
      `INSERT INTO "Citation" ("OwnerId","TreeId","SourceId","FactTable","FactId","Page","Note")
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [U, T, sourceId, factTable, factId, page, note],
    );
  // Citation."Note" -> generator.ts pushCitations' `2 NOTE <text>` under the
  // SOURCE_CITATION — distinct from the shared first-class Note/NoteLink model,
  // and previously never exercised by this fixture.
  await cite('People', stored, 'p. 1', 'Witnessed by the parish clerk.'); // whole-person → .ged 1 SOUR
  await cite('PersonBirth', stored, 'p. 2');       // birth fact  → .ged 2 SOUR under BIRT
  await cite('Events', eventId, 'p. 3');           // event       → .ged 2 SOUR under RESI
  await cite('Families', familyIds.married, 'p. 4');
  await cite('FamilyMarriage', familyIds.married, 'p. 4m'); // marriage → 2 SOUR under MARR (#962)
  await cite('PersonName', stored, 'p. 5');       // name fact  -> 2 SOUR under NAME
  await cite('PersonDeath', stored, 'p. 6');      // death fact -> 2 SOUR under DEAT
  // Citation."Part" -> 3 SOUR under the event's DATE line, not the whole event (#990).
  await cite('Events', eventId, 'p. 3d');
  await db.query(`UPDATE "Citation" SET "Part" = 'DATE' WHERE "TreeId" = $1 AND "Page" = 'p. 3d'`, [T]);
  // SOURCE_CITATION evidence sub-fields (Slice 3): QUAY, EVEN/ROLE and DATA.DATE/
  // DATA.TEXT all have real emit/import branches and none were exercised. Url is
  // the record link, written as `_LINK` (ADR 0025).
  await db.query(
    `INSERT INTO "Citation" ("OwnerId","TreeId","SourceId","FactTable","FactId","Page",
      "Quay","Even","Role","DataDate","DataText","Url")
     VALUES ($1,$2,$3,'People',$4,$5,$6,$7,$8,$9,$10,$11)`,
    [U, T, sourceId, fresh, 'p. 7', '3', 'BIRT', 'MOTH', '12 MAR 1900',
     'Transcribed text of the cited passage.', 'https://records.example.org/entry/7'],
  );

  // Cases live only in cases.json. Structured citations exercise the sidecar
  // pointer map; the retired free-text CaseCitations table is not part of the
  // current fixture schema.
  const caseIds: Record<string, number> = {};
  const caseRow = await db.query<{ Id: number }>(
    `INSERT INTO "Cases" ("UserId","TreeId","Title","Description","Status","Tags")
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING "Id"`,
    [U, T, 'Saint-Sulpice parentage review', 'Resolve the conflicting baptismal entries.', 'in_progress', ['parentage', 'paris']],
  );
  caseIds.parentage = caseRow.rows[0].Id;
  await db.query(
    'INSERT INTO "CasePerson" ("CaseId","PersonId") VALUES ($1,$2)',
    [caseIds.parentage, stored],
  );
  await db.query(
    'INSERT INTO "CaseComments" ("CaseId","UserId","Body") VALUES ($1,$2,$3)',
    [caseIds.parentage, U, 'Check the original register before closing the case.'],
  );
  // A status line the app logs (#801) carries its Kind through cases.json.
  await db.query(
    `INSERT INTO "CaseComments" ("CaseId","UserId","Body","Kind","CreatedAt")
     VALUES ($1,$2,'on_hold','status', NOW() + INTERVAL '1 minute')`,
    [caseIds.parentage, U],
  );
  await cite('Cases', caseIds.parentage, 'p. 8');
  // Every Citation field a case or journal citation has rides in cases.json (#1035).
  await db.query(
    `UPDATE "Citation" SET "Quay" = '2', "DataText" = 'Baptised the 3rd, godfather present.', "DataDate" = '3 JAN 1900',
       "Even" = 'BAPM', "Role" = 'CHIL', "Url" = 'https://records.example.org/case/8'
     WHERE "TreeId" = $1 AND "FactTable" = 'Cases' AND "Page" = 'p. 8'`,
    [T],
  );
  const journalEntry = (await db.query<{ Id: number }>(
    `SELECT "Id" FROM "CaseComments" WHERE "CaseId" = $1 AND "Kind" IS NULL`,
    [caseIds.parentage],
  )).rows[0].Id;
  await db.query(
    `INSERT INTO "Citation" ("OwnerId","TreeId","SourceId","FactTable","FactId","Page","Note","Quay","DataText","Url")
     VALUES ($1,$2,$3,'CaseComments',$4,'p. 9','Margin note.','1','Entry 9, struck through.','https://records.example.org/journal/9')`,
    [U, T, sourceId, journalEntry],
  );

  // The research workspace (#58, ADR 0045): the case's scope, its first lead and a
  // second, settled one, a request, a record with its citation and claims, a
  // search, and journal entries filed under leads, all through cases.json.
  await db.query(
    `UPDATE "Cases" SET "FromYear" = 1895, "ToYear" = 1905, "Place" = 'Paris', "QuestionKind" = 'parents' WHERE "Id" = $1`,
    [caseIds.parentage],
  );
  const lead = async (question: string, position: number, settled: boolean) => (await db.query<{ Id: number }>(
    `INSERT INTO "CaseLeads" ("CaseId","Question","FromYear","ToYear","Position","CreatedBy","SettledAt","SettledBy")
     VALUES ($1,$2,1899,1901,$3,$4,${settled ? "NOW()" : 'NULL'},${settled ? '$4' : 'NULL'}) RETURNING "Id"`,
    [caseIds.parentage, question, position, U],
  )).rows[0].Id;
  const firstLead = await lead('Saint-Sulpice parentage review', 0, false);
  const registerLead = await lead('Find the baptism in the register', 1, true);
  await db.query('INSERT INTO "CaseLeadPerson" ("LeadId","PersonId") VALUES ($1,$3), ($2,$3)', [firstLead, registerLead, stored]);
  const requestId = (await db.query<{ Id: number }>(
    `INSERT INTO "CaseRequests" ("CaseId","LeadId","UserId","AskedFor","Holder","SentBy","SentOn","Reference","RemindOn","State","RepliedAt","ReplyNote")
     VALUES ($1,$2,$3,'Baptism entry, 1900','Archives de Paris','email','2026-10-01','REF-77','2026-11-01','received',NOW(),'Scan attached.') RETURNING "Id"`,
    [caseIds.parentage, registerLead, U],
  )).rows[0].Id;
  const findingId = (await db.query<{ Id: number }>(
    `INSERT INTO "CaseFindings" ("CaseId","UserId","Kind","SourceNature","Information","Note","RequestId")
     VALUES ($1,$2,'record','original','primary','The baptism, with both parents named.',$3) RETURNING "Id"`,
    [caseIds.parentage, U, requestId],
  )).rows[0].Id;
  await db.query(
    `INSERT INTO "Citation" ("OwnerId","TreeId","SourceId","FactTable","FactId","Page","DataText")
     VALUES ($1,$2,$3,'CaseFindings',$4,'f. 12','Baptised Jeanne, daughter of Louis.')`,
    [U, T, sourceId, findingId],
  );
  await db.query('INSERT INTO "CaseFindingLead" ("FindingId","LeadId") VALUES ($1,$2)', [findingId, registerLead]);
  await db.query(
    `INSERT INTO "CaseClaims" ("FindingId","Position","What","PersonId","Says","Date","Place","Evidence","Decision","DecidedAt","DecidedBy")
     VALUES ($1,0,'BAPM',$2,'Baptised','3 JAN 1900','Paris','direct','accepted',NOW(),$3),
            ($1,1,'Father',NULL,'Louis','3 JAN 1900',NULL,'indirect','rejected',NOW(),$3)`,
    [findingId, stored, U],
  );
  await db.query('UPDATE "CaseClaims" SET "PersonName" = $2 WHERE "FindingId" = $1 AND "PersonId" IS NULL', [findingId, 'Louis Martin']);
  const searchId = (await db.query<{ Id: number }>(
    `INSERT INTO "CaseFindings" ("CaseId","UserId","Kind","Searched","Site","Note")
     VALUES ($1,$2,'nothing','Civil births, 1900','Archives de Paris online','No entry under either spelling.') RETURNING "Id"`,
    [caseIds.parentage, U],
  )).rows[0].Id;
  await db.query('INSERT INTO "CaseFindingLead" ("FindingId","LeadId") VALUES ($1,$2)', [searchId, firstLead]);
  const entry = async (kind: string, body: string, minutes: number, link: { finding?: number; request?: number }, leads: number[]) => {
    const id = (await db.query<{ Id: number }>(
      `INSERT INTO "CaseComments" ("CaseId","UserId","Body","Kind","CreatedAt","FindingId","RequestId")
       VALUES ($1,$2,$3,$4, NOW() + ($5 || ' minutes')::interval, $6, $7) RETURNING "Id"`,
      [caseIds.parentage, U, body, kind, String(minutes), link.finding ?? null, link.request ?? null],
    )).rows[0].Id;
    for (const l of leads) await db.query('INSERT INTO "CaseCommentLead" ("CommentId","LeadId") VALUES ($1,$2)', [id, l]);
  };
  await entry('request', 'Baptism entry, 1900', 2, { request: requestId }, [registerLead]);
  await entry('finding', 'Parish register', 3, { finding: findingId }, [registerLead]);
  await entry('search', 'Civil births, 1900', 4, { finding: searchId }, [firstLead]);
  await entry('lead', 'settled', 5, {}, [registerLead]);

  // A closed case keeps how and when it closed (#58).
  const closedCase = (await db.query<{ Id: number }>(
    `INSERT INTO "Cases" ("UserId","TreeId","Title","Status","Outcome","ClosedAt")
     VALUES ($1,$2,'Was Louis a carpenter?','closed','ruled_out',NOW()) RETURNING "Id"`,
    [U, T],
  )).rows[0].Id;
  await db.query(
    `INSERT INTO "CaseLeads" ("CaseId","Question","Position","CreatedBy") VALUES ($1,'Was Louis a carpenter?',0,$2)`,
    [closedCase, U],
  );
  await db.query(
    `INSERT INTO "CaseComments" ("CaseId","UserId","Body","Kind") VALUES ($1,$2,'He was a mason, not a carpenter.','conclusion')`,
    [closedCase, U],
  );

  // Notes at all three scopes. "NoteLink"."OwnerId" is the OWNER RECORD's id
  // (polymorphic, paired with "OwnerTable") — not a user id — and the link table
  // carries no "TreeId" of its own; scope comes from the parent "Note".
  const note = async (
    text: string,
    ownerTable: string,
    ownerRecordId: number,
    options: { xref?: string | null; ownerFact?: 'Birth' | 'Death' | 'Marriage' } = {},
  ) => {
    const n = await db.query<{ Id: number }>(
      'INSERT INTO "Note" ("OwnerId","TreeId","Text","GedcomXref") VALUES ($1,$2,$3,$4) RETURNING "Id"',
      [U, T, text, options.xref ?? null],
    );
    await db.query(
      'INSERT INTO "NoteLink" ("NoteId","OwnerTable","OwnerId","OwnerFact") VALUES ($1,$2,$3,$4)',
      [n.rows[0].Id, ownerTable, ownerRecordId, options.ownerFact ?? null],
    );
    return n.rows[0].Id;
  };
  // Carries the escaping hazard that used to live in People."Notes" (a literal @,
  // which is the GEDCOM xref delimiter, plus non-ASCII). That column is gone in
  // #524 / ADR 0010, so the hazard rides on the first-class note instead — dropping
  // it with the column would have quietly retired the coverage.
  await note('Person-scope note — accented: naïve, café, and a literal @ sign.', 'People', stored);
  await note('Birth-fact note.', 'People', stored, { ownerFact: 'Birth' });
  await note('Death-fact note.', 'People', stored, { ownerFact: 'Death' });
  await note('Event-scope note.', 'Events', eventId);
  await note('Family-scope note.', 'Families', familyIds.married);
  await note('Marriage-fact note.', 'Families', familyIds.married, { ownerFact: 'Marriage' });
  await note('Family-event-scope note.', 'Events', famEvt.Id);
  await note('Source-scope note.', 'Sources', sourceId);
  await note('Shared note linked to two owners.', 'People', stored, { xref: '@N_SHARED@' });
  await note('Shared note linked to two owners.', 'Families', familyIds.married, { xref: '@N_SHARED@' });
  // Repository notes are new (ADR 0012) — REPOSITORY_RECORD's NOTE_STRUCTURE was
  // dropped entirely on import before, with no passthrough to catch it.
  await note('Repository-scope note — access restricted.', 'Repository', repo.rows[0].Id);

  // Media: one shared row across all four canonical owner tables, one
  // ownerless row, and two distinct rows sharing a basename with different
  // geometry. One canonical primary is tagged; the other is intentionally
  // untagged so the GEDCOM primary xref path is exercised independently.
  const mediaIds: Record<string, number> = {};
  const media = async (key: string, filePath: string | null, title: string) => {
    const pdf = filePath?.endsWith('.pdf') ?? false;
    const m = await db.query<{ Id: number }>(
      `INSERT INTO "Media"
       ("UserId","TreeId","FilePath","Title","Format","ContentType","FocalX","FocalY","FocalRadius")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING "Id"`,
       [U, T, filePath, title, pdf ? 'PDF' : 'jpeg', pdf ? 'application/pdf' : 'image/jpeg',
       key === 'owned' ? 20 : key === 'shared' ? 80 : 65,
       key === 'owned' ? 30 : key === 'shared' ? 15 : 75,
       key === 'owned' ? 25 : key === 'shared' ? 10 : 35],
    );
    mediaIds[key] = m.rows[0].Id;
    return m.rows[0].Id;
  };
  // FilePath is relative to the owner's hosted media directory. Keep one
  // nested path so the fixture still proves that two distinct archive entries
  // may share a basename without relying on the retired basename-only lookup.
  const owned = await media('owned', 'portrait.jpg', 'Portrait');
  // A photo date (#802) rides in media.json's additive `dates`.
  await db.query(`UPDATE "Media" SET "Date" = 'ABT 1900' WHERE "Id" = $1`, [owned]);
  // FILE sub-lines the app doesn't model ride under FILE (#976).
  await db.query(`UPDATE "Media" SET "FileRawGedcom" = $1 WHERE "Id" = $2`, ['1 _DATE 5/20/2017 1:51:01 PM\n1 _TEXT Census page', owned]);
  await media('library', 'unowned.jpg', 'Library photo');
  const shared = await media('shared', 'shared.jpg', 'Shared all-owner photo');
  const familyLinked = await media('familyLinked', 'family-document.jpg', 'Family document');
  // A PDF document (#510) on a source rides the bundle like a photo.
  const pdfDocument = await media('pdfDocument', 'birth-register.pdf', 'Birth register');
  // Media under a citation rides the citation raw, its pointer stored as an id (#976).
  await db.query(
    `UPDATE "Citation" SET "RawGedcom" = $1 WHERE "TreeId" = $2 AND "FactTable" = 'PersonBirth' AND "Page" = 'p. 2'`,
    [`1 OBJE @~O:${shared}@`, T],
  );
  // A desktop app's absolute FILE whose bytes never arrived (#958): a pending
  // reference that exports its FILE text verbatim and re-imports as one again.
  const reference = await media('reference', null, 'Desktop reference');
  await db.query(`UPDATE "Media" SET "SourceFile" = $1, "ContentType" = NULL WHERE "Id" = $2`, ['C:\\FTM\\Tree Media\\reference.jpg', reference]);
  await db.query(`INSERT INTO "MediaLink" ("MediaId","OwnerTable","OwnerId","IsPrimary") VALUES ($1,'People',$2,0)`, [reference, personIds.fresh]);
  await db.query(
    `INSERT INTO "MediaLink" ("MediaId","OwnerTable","OwnerId","IsPrimary") VALUES
      ($1,'People',$2,1), ($1,'Families',$3,0), ($1,'Sources',$4,0), ($1,'Events',$5,0)`,
    [shared, personIds.fresh, familyIds.married, sourceId, eventId],
  );
  await db.query(
    'INSERT INTO "MediaLink" ("MediaId","OwnerTable","OwnerId","IsPrimary") VALUES ($1,$2,$3,1)',
    [owned, 'People', stored],
  );
  await db.query(
    'INSERT INTO "MediaLink" ("MediaId","OwnerTable","OwnerId","IsPrimary") VALUES ($1,$2,$3,0)',
    [familyLinked, 'Families', familyIds.married],
  );
  await db.query(
    'INSERT INTO "MediaLink" ("MediaId","OwnerTable","OwnerId","IsPrimary") VALUES ($1,$2,$3,0)',
    [pdfDocument, 'Sources', sourceId],
  );
  // Same basename as `owned`, different row — basename-keyed sidecar matching hazard.
  const dupeBasename = await media('dupeBasename', 'nested/portrait.jpg', 'Same basename');
  await db.query(
    'INSERT INTO "MediaLink" ("MediaId","OwnerTable","OwnerId","IsPrimary") VALUES ($1,$2,$3,0)',
    [dupeBasename, 'People', fresh],
  );

  // A case's attached photo and a journal entry's photo ride in cases.json by
  // media xref (#1068). Neither is a MediaLink, so the library photo stays ownerless.
  await db.query('INSERT INTO "CaseMedia" ("CaseId","MediaId") VALUES ($1,$2)', [caseIds.parentage, mediaIds.library]);
  await db.query('UPDATE "CaseComments" SET "MediaId" = $1 WHERE "Id" = $2', [shared, journalEntry]);

  // Face tag points at the same person who owns the canonical primary photo.
  // Region columns are RegionX/Y/W/H, and the table is scoped through its
  // "Media" row (no OwnerId/TreeId of its own).
  await db.query(
    `INSERT INTO "MediaTag" ("MediaId","PersonId","RegionX","RegionY","RegionW","RegionH")
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [owned, stored, 10, 20, 30, 40],
  );

  // Name variants — one primary, one not (the IsPrimary invisibility trap).
  // "IsPrimary" is INTEGER, and a partial unique index allows at most one
  // primary per person.
  const nameVariant = async (personId: number, type: string, name: string, isPrimary: boolean) =>
    db.query<{ Id: number }>(
      'INSERT INTO "NameVariant" ("OwnerId","TreeId","PersonId","Type","Name","IsPrimary") VALUES ($1,$2,$3,$4,$5,$6) RETURNING "Id"',
      [U, T, personId, type, name, isPrimary ? 1 : 0],
    );
  // Types must be the app's own vocabulary (Given / Nickname / Maiden /
  // Anglicized / Alias — see app/components/person-form/NamesPanel.tsx), NOT the
  // GEDCOM tag names. The generator only emits `1 NICK` / `1 _AKA` for
  // 'Nickname' / 'Alias' (lib/gedcom/generator.ts), so any other value would
  // silently skip the GEDCOM emit + reimport path entirely.
  await nameVariant(stored, 'Nickname', 'Ellie', true);
  const alias = await nameVariant(stored, 'Alias', 'É. Smith', false);
  // A variant citation rides under `1 _AKA` in the .ged AND in sources.json (#963):
  // a bare .ged keeps it, and a bundle import must keep exactly one copy.
  await cite('NameVariant', alias.rows[0].Id, 'p. 8');

  // Gazetteer: hierarchy + coords + FORM. Names are unique per (TreeId, Name),
  // and the child's name matches the BirthPlace/MarriagePlace strings above so
  // its coordinates reach PLAC.MAP.
  // The gazetteer is seeded as the FULL hierarchy the importer's place-promotion
  // pass derives from comma segments ('Paris, Île-de-France, France' → 'Île-de-
  // France, France' → 'France'). That pass runs on every import, so if `before`
  // held only the leaves, `after` would legitimately gain the derived ancestors
  // and the channel could never be equal — the mismatch would be the FIXTURE's,
  // not a defect. A real database reaches this same shape after its first import.
  //
  // The unreferenced rows are the point of #402: 'France' and 'Canada' are named
  // by no fact, so before places.json they had nowhere to ride and came back
  // stripped of Form and coordinates.
  const mkPlace = async (
    name: string, form: string | null, lat: number | null, lng: number | null,
    parentId: number | null,
    geo?: { displayName?: string; osmType?: string; osmId?: number; osmKind?: string; pinSuppressed?: boolean },
  ): Promise<number> => {
    const values = [U, T, name, form, lat, lng, parentId,
      geo?.displayName ?? null, geo?.osmType ?? null, geo?.osmId ?? null, geo?.pinSuppressed ?? false, geo?.osmKind ?? null];
    // A fact above already made the bare place of its name (ADR 0037): fill that one in.
    const existing = await db.query<{ Id: number }>(
      `UPDATE "Places" SET "Form" = $4, "Latitude" = $5, "Longitude" = $6, "ParentId" = $7, "DisplayName" = $8,
              "OsmType" = $9, "OsmId" = $10, "PinSuppressed" = $11, "OsmKind" = $12
        WHERE "Id" = "PlaceIdByName"($2, $3) AND "Name" = $3 AND "UserId" = $1 RETURNING "Id"`,
      values,
    );
    if (existing.rows[0]) return existing.rows[0].Id;
    const r = await db.query<{ Id: number }>(
      `INSERT INTO "Places"
       ("UserId","TreeId","Name","Form","Latitude","Longitude","ParentId","DisplayName","OsmType","OsmId","PinSuppressed","OsmKind")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING "Id"`,
      values,
    );
    return r.rows[0].Id;
  };

  const country = { rows: [{ Id: await mkPlace('France', 'Country', 46.6, 2.2, null) }] };
  const idf = await mkPlace('Île-de-France, France', 'Region', 48.7, 2.5, country.rows[0].Id);
  // Geocoder fields + the PinSuppressed user toggle ride only in places.json — the
  // .ged has no PLAC sub-structure for any of them.
  const paris = { rows: [{ Id: await mkPlace(
    'Paris, Île-de-France, France', 'City', 48.8566, 2.3522, idf,
    { displayName: 'Paris, Île-de-France, France métropolitaine', osmType: 'relation', osmId: 7444, osmKind: 'place/city', pinSuppressed: true },
  ) }] };

  const canada = await mkPlace('Canada', 'Country', 56.1, -106.3, null);
  const quebec = await mkPlace('Québec, Canada', 'Province', 52.9, -73.5, canada);
  await mkPlace('Montréal, Québec, Canada', 'City', 45.5019, -73.5674, quebec);
  // Place-scope note — PLACE_STRUCTURE's own NOTE_STRUCTURE, emitted under the
  // PLAC line rather than the record. Previously unexercised.
  await note('Place-scope note — commune boundaries changed in 1860.', 'Places', paris.rows[0].Id);

  return { userId: U, treeId: T, personIds, familyIds, caseIds, sourceId, mediaIds };
}
