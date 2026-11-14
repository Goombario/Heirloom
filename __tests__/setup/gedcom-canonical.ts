import { query } from '@/lib/db/connection.pglite';
import { factPlaceTextColumns } from '@/lib/db/queries/place-links';

/** One projected record. Values are plain JSON scalars, arrays or nested rows. */
export type CanonicalRow = Record<string, unknown>;

/**
 * A tree projected into a form that is invariant under a GEDCOM round trip.
 *
 * One property per lossy surface so a failing `toEqual` names the surface
 * directly instead of dumping the whole tree.
 */
export interface CanonicalTree {
  people: CanonicalRow[];
  families: CanonicalRow[];
  events: CanonicalRow[];
  sources: CanonicalRow[];
  repositories: CanonicalRow[];
  citations: CanonicalRow[];
  notes: CanonicalRow[];
  nameVariants: CanonicalRow[];
  media: CanonicalRow[];
  mediaLinks: CanonicalRow[];
  mediaTags: CanonicalRow[];
  places: CanonicalRow[];
  cases: CanonicalRow[];
}

export interface CanonicalQueryExecutor {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

interface PersonRow {
  Id: number;
  FirstName: string | null;
  LastName: string | null;
  Sex: string | null;
  GedcomId: string | null;
  BirthDate: string | null;
  BirthPlace: string | null;
  DeathDate: string | null;
  DeathPlace: string | null;
  DeathCause: string | null;
  IsDeceased: number | null;
  // No `Notes`: the column was dropped in #524 / ADR 0010. A person's notes are
  // Note + NoteLink rows, already compared through the `notes` projection below.
  RawGedcom: string | null;
  BirthRawGedcom: string | null;
  DeathRawGedcom: string | null;
}

interface FamilyRow {
  Id: number;
  HusbandId: number | null;
  WifeId: number | null;
  Partner1Id: number | null;
  Partner2Id: number | null;
  MarriageDate: string | null;
  MarriagePlace: string | null;
  Type: string | null;
  RawGedcom: string | null;
  MarriageRawGedcom: string | null;
  Partner1RawGedcom: string | null;
  Partner2RawGedcom: string | null;
}

interface EventRow {
  Id: number;
  PersonId: number | null;
  FamilyId: number | null;
  Type: string;
  Date: string | null;
  Place: string | null;
  Description: string | null;
  RawGedcom: string | null;
}

interface SourceRow {
  Id: number;
  Title: string | null;
  Author: string | null;
  PublicationInfo: string | null;
  RepositoryName: string | null;
  CallNumber: string | null;
  Type: string | null;
  Text: string | null;
  Contents: string | null;
  Num: number | null;
  RepositoryMedi: string | null;
  RawGedcom: string | null;
}

interface NameVariantRow {
  Id: number;
  PersonId: number;
  Type: string;
  Name: string;
  IsPrimary: number;
  FromDate: string | null;
  ToDate: string | null;
}

interface MediaRow {
  Id: number;
  FilePath: string | null;
  Title: string | null;
  Format: string | null;
  ContentType: string | null;
  FocalX: number | null;
  FocalY: number | null;
  FocalRadius: number | null;
  FileRawGedcom: string | null;
}

interface CaseRow {
  Id: number;
  Title: string;
  Description: string | null;
  Status: string;
  Tags: string[];
}

/**
 * Deterministic order that cannot depend on insertion order or surrogate ids.
 * Exported so a caller that narrows a projection (dropping a quarantined field)
 * can re-establish the SAME ordering — otherwise the dropped field's own change
 * could reshuffle the array and fail the narrowed comparison spuriously.
 */
export function sortByJson<T>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ja = JSON.stringify(a);
    const jb = JSON.stringify(b);
    return ja < jb ? -1 : ja > jb ? 1 : 0;
  });
}

/**
 * Normalize only the archive filename generated during a completed import.
 * Media xrefs and their record order remain visible; the hosted/local upload
 * step is deliberately allowed to mint a fresh basename for each FilePath.
 */
export function normalizeGedcomArchivePaths(ged: string): string {
  return ged.replace(/^(\d+ FILE )(?:\/uploads\/[^\r\n]*\/media\/|media\/O\d+[-/]|imported_)[^\r\n]+$/gm, '$1<ARCHIVE_PATH>');
}

/** Last path segment of a stored `FilePath`, handling both separators. */
function basename(filePath: string | null): string | null {
  if (filePath === null) return null;
  return filePath.split(/[\\/]/).pop() ?? null;
}

/**
 * Project a tree into a form that is invariant under a GEDCOM round trip:
 * surrogate ids replaced by natural keys, volatile columns dropped, every
 * collection deterministically ordered. Equality of two projections is the
 * strongest "nothing was lost" claim available for a lossy interchange format —
 * and unlike a hash it produces a readable diff when it breaks.
 *
 * Normalization rules:
 *  - **Drop** `Id`, `TreeId`, `UserId`, `OwnerId`, `CreatedAt`, `UpdatedAt` —
 *    reassigned or restamped by every import.
 *  - **Replace** every foreign key with a natural key derived from the data
 *    itself, so a pointer that drifts onto a different record still fails.
 *  - **Sort** every collection by its JSON form.
 *  - **Keep** `GedcomId`: it is the merge-reimport match key, i.e. semantic.
 *
 * Nothing here is projected away in order to make a channel pass; a field that
 * cannot survive is left in and quarantined at the assertion instead.
 */
export async function canonicalizeTree(
  treeId: number,
  executor: CanonicalQueryExecutor = { query },
): Promise<CanonicalTree> {
  const rows = async <T>(sql: string, params: unknown[]): Promise<T[]> => {
    const result = await executor.query(sql, params);
    return result.rows as T[];
  };
  const peopleRows = await rows<PersonRow>(
    `SELECT p."Id",p."FirstName",p."LastName",p."Sex",p."GedcomId",p."BirthDate",
            p."DeathDate",p."DeathCause",p."IsDeceased",p."RawGedcom",
            p."BirthRawGedcom",p."DeathRawGedcom", ${factPlaceTextColumns('people', 'p')}
       FROM "People" p WHERE p."TreeId" = $1`,
    [treeId],
  );
  const personKey = new Map<number, string>();
  for (const p of peopleRows) {
    personKey.set(p.Id, `${p.FirstName ?? ''}|${p.LastName ?? ''}|${p.BirthDate ?? ''}`);
  }
  /** DB person id → natural key. A dangling id becomes a loud marker, not null. */
  const pk = (id: number | null): string | null =>
    id === null ? null : personKey.get(id) ?? `<missing person:${id}>`;

  const familyRows = await rows<FamilyRow>(
    // "RawGedcom" is the unmodeled-subtree passthrough, emitted by
    // generator.ts:826 and re-imported by services/gedcom.ts:1227 — the same
    // channel as People."RawGedcom", which this projection already compares.
    `SELECT f."Id",f."HusbandId",f."WifeId",f."Partner1Id",f."Partner2Id",f."MarriageDate",f."Type",f."RawGedcom",f."MarriageRawGedcom",
            f."Partner1RawGedcom",f."Partner2RawGedcom", ${factPlaceTextColumns('families', 'f')}
       FROM "Families" f WHERE f."TreeId" = $1`,
    [treeId],
  );
  const familyKey = new Map<number, string>();
  for (const f of familyRows) {
    // Spouses identify a family; the fixture has no two families with the same pair.
    familyKey.set(f.Id, `${pk(f.HusbandId ?? f.Partner1Id)}+${pk(f.WifeId ?? f.Partner2Id)}`);
  }
  const fk = (id: number | null): string | null =>
    id === null ? null : familyKey.get(id) ?? `<missing family:${id}>`;

  // "FamilyPerson" carries no "TreeId" of its own — scope comes from the family.
  const childRows = await rows<{ FamiliesAsChildId: number; ChildrenId: number; Partner1Relationship: string; Partner2Relationship: string; FamcRawGedcom: string | null; ChilRawGedcom: string | null }>(
    `SELECT fp."FamiliesAsChildId", fp."ChildrenId", fp."Partner1Relationship", fp."Partner2Relationship", fp."FamcRawGedcom", fp."ChilRawGedcom"
       FROM "FamilyPerson" fp
       JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId"
      WHERE f."TreeId" = $1`,
    [treeId],
  );
  const childrenByFamily = new Map<number, Array<{ child: string | null; Partner1Relationship: string; Partner2Relationship: string; FamcRawGedcom: string | null; ChilRawGedcom: string | null }>>();
  for (const c of childRows) {
    const list = childrenByFamily.get(c.FamiliesAsChildId) ?? [];
    list.push({ child: pk(c.ChildrenId), Partner1Relationship: c.Partner1Relationship, Partner2Relationship: c.Partner2Relationship, FamcRawGedcom: c.FamcRawGedcom, ChilRawGedcom: c.ChilRawGedcom });
    childrenByFamily.set(c.FamiliesAsChildId, list);
  }

  const eventRows = await rows<EventRow>(
    `SELECT e."Id",e."PersonId",e."FamilyId",e."Type",e."Date",e."Description",e."RawGedcom", ${factPlaceTextColumns('events', 'e')}
       FROM "Events" e WHERE e."TreeId" = $1`,
    [treeId],
  );
  // Owner + Type identifies an event; the fixture has no two events sharing both.
  // "Date" is deliberately NOT part of the key even though it would sharpen it:
  // event dates are still unstable across a round trip. The generator side is now
  // consistent — person AND family event dates both go through
  // formatDateForGedcom (lib/gedcom/generator.ts:579, :783; fixed in 3e7acae) —
  // but the PARSER assigns the raw GEDCOM value to Events."Date" rather than
  // normalising it back to ISO (see the quarantined 'preserves event dates
  // exactly' assertion in __tests__/unit/gedcom-roundtrip-semantic.pglite.test.ts), so
  // the representation still shifts. A key built on an unstable value would
  // contaminate every projection that
  // references an event — a note's owner would "differ" because of a date. The
  // date is still asserted as a VALUE in the events channel, which is where a
  // change to it belongs.
  const eventKey = new Map<number, string>();
  for (const e of eventRows) {
    eventKey.set(e.Id, `${pk(e.PersonId) ?? fk(e.FamilyId) ?? ''}|${e.Type}`);
  }

  const sourceRows = await rows<SourceRow>(
    // "RawGedcom": passthrough channel, generator.ts:433 / services/gedcom.ts:1013.
    `SELECT "Id","Title","Author","PublicationInfo","RepositoryName","CallNumber",
            "Type","Text","Contents","Num","RepositoryMedi","RawGedcom"
       FROM "Sources" WHERE "TreeId" = $1`,
    [treeId],
  );
  // Title is the source's natural key (unique within the fixture tree).
  const sourceTitle = new Map(sourceRows.map(s => [s.Id, s.Title]));

  const caseRows = await rows<CaseRow>(
    `SELECT "Id","Title","Description","Status","Tags"
       FROM "Cases" WHERE "TreeId" = $1`,
    [treeId],
  );
  const caseKey = new Map(caseRows.map(c => [c.Id, c.Title]));
  const casePeople = await rows<{ CaseId: number; PersonId: number }>(
    `SELECT "CaseId","PersonId" FROM "CasePerson" WHERE "CaseId" IN (
       SELECT "Id" FROM "Cases" WHERE "TreeId" = $1
     )`,
    [treeId],
  );
  const peopleByCase = new Map<number, string[]>();
  for (const link of casePeople) {
    const list = peopleByCase.get(link.CaseId) ?? [];
    list.push(pk(link.PersonId) ?? `<missing person:${link.PersonId}>`);
    peopleByCase.set(link.CaseId, list);
  }
  const caseComments = await rows<{ Id: number; CaseId: number; Body: string; MediaId: number | null }>(
    `SELECT "Id","CaseId","Body","MediaId" FROM "CaseComments"
     WHERE "CaseId" IN (SELECT "Id" FROM "Cases" WHERE "TreeId" = $1)`,
    [treeId],
  );
  // A journal entry's natural key: its case and body. The fixture's bodies are unique per case.
  const commentKey = new Map(caseComments.map(cm => [cm.Id, `${caseKey.get(cm.CaseId) ?? `<missing case:${cm.CaseId}>`}: ${cm.Body}`]));
  // A case finding's natural key (#58): its case, kind, and what was searched or its note.
  const caseFindings = await rows<{ Id: number; CaseId: number; Kind: string; Searched: string | null; Note: string | null }>(
    `SELECT "Id","CaseId","Kind","Searched","Note" FROM "CaseFindings"
     WHERE "CaseId" IN (SELECT "Id" FROM "Cases" WHERE "TreeId" = $1)`,
    [treeId],
  );
  const findingKey = new Map(caseFindings.map(f => [f.Id, `${caseKey.get(f.CaseId) ?? `<missing case:${f.CaseId}>`}: ${f.Kind} ${f.Searched ?? f.Note ?? ''}`]));
  const caseMedia = await rows<{ CaseId: number; MediaId: number }>(
    `SELECT "CaseId","MediaId" FROM "CaseMedia"
     WHERE "CaseId" IN (SELECT "Id" FROM "Cases" WHERE "TreeId" = $1)`,
    [treeId],
  );

  // "Id" is selected only to resolve note owners by natural key (see
  // noteOwnerKey); it is stripped before the repositories channel is compared,
  // since a re-import reassigns it.
  const repositoryRows = await rows<{ Id: number; Name: string; Address: string | null; Website: string | null; Phone: string | null; Email: string | null }>(
    'SELECT "Id","Name","Address","Website","Phone","Email" FROM "Repository" WHERE "TreeId" = $1',
    [treeId],
  );
  const repositoryName = new Map(repositoryRows.map(r => [r.Id, r.Name]));

  const nameVariantRows = await rows<NameVariantRow>(
    `SELECT "Id","PersonId","Type","Name","IsPrimary","FromDate","ToDate"
       FROM "NameVariant" WHERE "TreeId" = $1`,
    [treeId],
  );
  const nameVariantKey = new Map<number, string>();
  for (const nv of nameVariantRows) {
    nameVariantKey.set(nv.Id, `${pk(nv.PersonId)}|${nv.Type}|${nv.Name}`);
  }

  const placeRows = await rows<{
    Id: number; Name: string; Form: string | null; Latitude: number | null;
    Longitude: number | null; ParentId: number | null;
    DisplayName: string | null; OsmType: string | null;
    OsmId: number | string | null; PinSuppressed: boolean | null;
  }>(
    `SELECT "Id","Name","Form","Latitude","Longitude","ParentId",
            "DisplayName","OsmType","OsmId","PinSuppressed"
     FROM "Places" WHERE "TreeId" = $1`,
    [treeId],
  );
  const placeName = new Map(placeRows.map(p => [p.Id, p.Name]));

  const mediaRows = await rows<MediaRow>(
    `SELECT "Id","FilePath","Title","Format","ContentType","FocalX","FocalY","FocalRadius","FileRawGedcom"
       FROM "Media" WHERE "TreeId" = $1`,
    [treeId],
  );
  const mediaKey = new Map(mediaRows.map(m => [m.Id, `${m.Title ?? ''}|${m.Format ?? ''}`]));
  const mediaLinkRows = await rows<{ MediaId: number; OwnerTable: string; OwnerId: number; IsPrimary: number }>(
    `SELECT l."MediaId",l."OwnerTable",l."OwnerId",l."IsPrimary"
       FROM "MediaLink" l JOIN "Media" m ON m."Id" = l."MediaId"
      WHERE m."TreeId" = $1`,
    [treeId],
  );
  // "MediaTag" has no "TreeId"/"OwnerId" — it is scoped through its "Media" row,
  // and its region columns are RegionX/Y/W/H.
  const mediaTagRows = await rows<{
    PersonId: number; RegionX: number; RegionY: number; RegionW: number;
    RegionH: number; FilePath: string | null; MediaTitle: string | null;
  }>(
    `SELECT t."PersonId", t."RegionX", t."RegionY", t."RegionW", t."RegionH",
            m."FilePath", m."Title" AS "MediaTitle"
       FROM "MediaTag" t JOIN "Media" m ON m."Id" = t."MediaId"
      WHERE m."TreeId" = $1`,
    [treeId],
  );

  // The table is "Citation" (singular). "FactId" is polymorphic over "FactTable".
  const citationRows = await rows<{
    SourceId: number; FactTable: string; FactId: number; Page: string | null;
    Quay: string | null; DataText: string | null; DataDate: string | null;
    Even: string | null; Role: string | null; RawGedcom: string | null; Url: string | null;
  }>(
    `SELECT "SourceId","FactTable","FactId","Page","Quay","DataText","DataDate","Even","Role","RawGedcom","Url"
       FROM "Citation" WHERE "TreeId" = $1`,
    [treeId],
  );
  /** Resolve a polymorphic citation target to the natural key of its record. */
  const factKey = (factTable: string, factId: number): string | null => {
    switch (factTable) {
      // The person-keyed pseudo-facts: FactId is a Person.Id, not a row id in a
      // table of their own. Must match PERSON_KEYED_FACT_TABLES in
      // lib/db/fact-tables.ts — 'PersonName' was missing here, so a name citation
      // compared as a raw id and would have reported a false difference on every
      // run once one was seeded.
      case 'People':
      case 'PersonBirth':
      case 'PersonDeath':
      case 'PersonName':
        return pk(factId);
      case 'Events':
        return eventKey.get(factId) ?? `<missing event:${factId}>`;
      case 'Families':
      case 'family':
        return fk(factId);
      case 'FamilyMarriage':
        return `marriage of ${fk(factId)}`;
      case 'Cases':
        return caseKey.get(factId) ?? `<missing case:${factId}>`;
      case 'CaseComments':
        return commentKey.get(factId) ?? `<missing journal entry:${factId}>`;
      case 'CaseFindings':
        return findingKey.get(factId) ?? `<missing finding:${factId}>`;
      case 'NameVariant':
        return nameVariantKey.get(factId) ?? `<missing nameVariant:${factId}>`;
      default:
        return `<unresolved ${factTable}:${factId}>`;
    }
  };

  // "Note" is singular and "NoteLink"."OwnerId" is the OWNER RECORD's id
  // (polymorphic, paired with "OwnerTable"), not a user id. The link table has no
  // "TreeId" — scope comes from the parent "Note".
  const noteRows = await rows<{ Text: string; OwnerTable: string; OwnerId: number; OwnerFact: string | null }>(
    `SELECT n."Text", l."OwnerTable", l."OwnerId", l."OwnerFact"
       FROM "Note" n JOIN "NoteLink" l ON l."NoteId" = n."Id"
      WHERE n."TreeId" = $1`,
    [treeId],
  );
  /** Which record a note hangs off — dropping this would erase misattribution. */
  const noteOwnerKey = (ownerTable: string, ownerId: number): string | null => {
    switch (ownerTable) {
      case 'People': return pk(ownerId);
      case 'Events': return eventKey.get(ownerId) ?? `<missing event:${ownerId}>`;
      case 'Families': return fk(ownerId);
      case 'Places': return placeName.get(ownerId) ?? `<missing place:${ownerId}>`;
      // Sources and Repository resolve to their natural keys for the same reason
      // as the cases above: the raw row id is reassigned by a re-import, so
      // comparing it would report a difference on every run regardless of whether
      // the note actually moved. Left unresolved until a source/repository note
      // was seeded, which is what surfaced it.
      case 'Sources': return sourceTitle.get(ownerId) ?? `<missing source:${ownerId}>`;
      case 'Repository': return repositoryName.get(ownerId) ?? `<missing repository:${ownerId}>`;
      case 'Cases': return caseKey.get(ownerId) ?? `<missing case:${ownerId}>`;
      default: return `<unresolved ${ownerTable}:${ownerId}>`;
    }
  };
  const mediaOwnerKey = (ownerTable: string, ownerId: number): string | null =>
    noteOwnerKey(ownerTable, ownerId);
  /** A passthrough pointer is stored as its record's id (#979), which a re-import reassigns. */
  const passthrough = (raw: string | null): string | null => raw?.replace(/@~([SNOIF]):(\d+)@/g, (_, kind: string, id: string) => {
    const target = kind === 'I' ? pk(Number(id)) : kind === 'F' ? fk(Number(id))
      : kind === 'S' ? sourceTitle.get(Number(id)) ?? `<missing source:${id}>`
      : kind === 'O' ? mediaKey.get(Number(id)) ?? `<missing media:${id}>` : `<unresolved ${kind}:${id}>`;
    return `@~${kind}:${target}@`;
  }) ?? null;

  return {
    people: sortByJson(peopleRows.map(({ Id: _id, ...rest }) => ({
      ...rest,
      RawGedcom: passthrough(rest.RawGedcom),
      BirthRawGedcom: passthrough(rest.BirthRawGedcom),
      DeathRawGedcom: passthrough(rest.DeathRawGedcom),
    }))),
    families: sortByJson(familyRows.map(f => ({
      husband: pk(f.HusbandId ?? f.Partner1Id),
      wife: pk(f.WifeId ?? f.Partner2Id),
      MarriageDate: f.MarriageDate,
      MarriagePlace: f.MarriagePlace,
      Type: f.Type,
      RawGedcom: passthrough(f.RawGedcom),
      MarriageRawGedcom: passthrough(f.MarriageRawGedcom),
      Partner1RawGedcom: passthrough(f.Partner1RawGedcom),
      Partner2RawGedcom: passthrough(f.Partner2RawGedcom),
      children: sortByJson((childrenByFamily.get(f.Id) ?? []).map((c) => ({
        ...c, FamcRawGedcom: passthrough(c.FamcRawGedcom), ChilRawGedcom: passthrough(c.ChilRawGedcom),
      }))),
    }))),
    events: sortByJson(eventRows.map(e => ({
      person: pk(e.PersonId),
      family: fk(e.FamilyId),
      Type: e.Type, Date: e.Date, Place: e.Place, Description: e.Description, RawGedcom: passthrough(e.RawGedcom),
    }))),
    sources: sortByJson(sourceRows.map(({ Id: _id, ...rest }) => rest)),
    repositories: sortByJson(repositoryRows.map(({ Id: _id, ...rest }) => rest)),
    citations: sortByJson(citationRows.map(c => ({
      source: sourceTitle.get(c.SourceId) ?? `<missing source:${c.SourceId}>`,
      FactTable: c.FactTable,
      fact: factKey(c.FactTable, c.FactId),
      Page: c.Page, Quay: c.Quay, DataText: c.DataText,
      DataDate: c.DataDate, Even: c.Even, Role: c.Role, RawGedcom: passthrough(c.RawGedcom), Url: c.Url,
    }))),
    notes: sortByJson(noteRows.map(n => ({
      Text: n.Text,
      OwnerTable: n.OwnerTable,
      owner: noteOwnerKey(n.OwnerTable, n.OwnerId),
      OwnerFact: n.OwnerFact,
    }))),
    nameVariants: sortByJson(nameVariantRows.map(nv => ({
      person: pk(nv.PersonId),
      Type: nv.Type, Name: nv.Name, IsPrimary: nv.IsPrimary,
      FromDate: nv.FromDate, ToDate: nv.ToDate,
    }))),
    media: sortByJson(mediaRows.map(m => ({
      file: basename(m.FilePath),
      Title: m.Title, Format: m.Format, ContentType: m.ContentType,
      FocalX: m.FocalX, FocalY: m.FocalY, FocalRadius: m.FocalRadius, FileRawGedcom: m.FileRawGedcom,
    }))),
    mediaLinks: sortByJson(mediaLinkRows.map(l => ({
      media: mediaKey.get(l.MediaId) ?? `<missing media:${l.MediaId}>`,
      OwnerTable: l.OwnerTable,
      owner: mediaOwnerKey(l.OwnerTable, l.OwnerId),
      IsPrimary: l.IsPrimary,
    }))),
    mediaTags: sortByJson(mediaTagRows.map(t => ({
      person: pk(t.PersonId),
      file: basename(t.FilePath),
      mediaTitle: t.MediaTitle,
      RegionX: t.RegionX, RegionY: t.RegionY, RegionW: t.RegionW, RegionH: t.RegionH,
    }))),
    cases: sortByJson(caseRows.map(c => ({
      Title: c.Title,
      Description: c.Description,
      Status: c.Status,
      Tags: c.Tags,
      linkedPeople: sortByJson(peopleByCase.get(c.Id) ?? []),
      // Each entry with its photo (#1068); its citation is in the citations channel (#1035).
      comments: sortByJson(caseComments.filter(cm => cm.CaseId === c.Id).map(cm => ({
        Body: cm.Body,
        media: cm.MediaId === null ? null : mediaKey.get(cm.MediaId) ?? `<missing media:${cm.MediaId}>`,
      }))),
      media: sortByJson(caseMedia.filter(cm => cm.CaseId === c.Id).map(cm => mediaKey.get(cm.MediaId) ?? `<missing media:${cm.MediaId}>`)),
    }))),
    places: sortByJson(placeRows.map(p => ({
      Name: p.Name, Form: p.Form, Latitude: p.Latitude, Longitude: p.Longitude,
      parent: p.ParentId === null ? null : placeName.get(p.ParentId) ?? `<missing place:${p.ParentId}>`,
      // Geocoder results and the map toggle (#402). These have NO .ged
      // representation at all, so they are the sharpest test of places.json:
      // if the sidecar is dropped, only these and the unreferenced rows change.
      DisplayName: p.DisplayName ?? null,
      OsmType: p.OsmType ?? null,
      OsmId: p.OsmId === null || p.OsmId === undefined ? null : String(p.OsmId),
      PinSuppressed: p.PinSuppressed === true,
    }))),
  };
}
