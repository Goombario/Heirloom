import type { FamilyWithRelations, PersonWithRelations } from '../db/schema';
import { formatDateForGedcom, sanitizeGedcomDateValue } from '../date-utils';
import { gedcomLatLng } from './coords';
import { archiveMediaPath } from '@/lib/gedcom/media-archive-name';
import { countStaleMediaPointers, dropDanglingPointers, markStaleMediaPointers, resolveRawPointerTokens, type RawPointerKind } from '@/lib/gedcom/raw-pointers';
import { CHILD_RELATIONSHIP_TO_FTM_VALUE, isChildRelationshipType, sharedChildRelationship } from '@/lib/child-relationship';
import { factPlaceKey, placeKeyString } from '@/lib/places/place-key';

export interface GedcomExportSource {
    Id: number;
    Title: string | null;
    Author: string | null;
    PublicationInfo: string | null;
    Text: string | null;       // the source's own website -> _URL (#1019)
    Contents: string | null;   // transcription -> TEXT
    Type: string | null;       // -> _TYPE
    Num: number | null;        // -> _NUM
    Abbreviation?: string | null;      // -> ABBR, the short filing title (#501)
    RepositoryName: string | null;
    CallNumber: string | null;
    RepositoryMedi?: string | null;    // CALN.MEDI — medium of the call number (Slice 4)
    RepositoryAddress?: string | null; // REPO.ADDR — emitted on the shared REPO record (Slice 4)
    RawGedcom?: string | null; // passthrough subtrees not modeled by the importer
}

export interface GedcomExportCitation {
    /** The row id, so the citation's own files (#47) can be found among `mediaLinks`. */
    Id?: number;
    FactTable: string;
    FactId: number;
    SourceId: number;
    Page: string | null;
    Note: string | null;
    // Slice 3 — SOURCE_CITATION evidence fields.
    Quay?: string | null;
    DataText?: string | null;
    DataDate?: string | null;
    Even?: string | null;
    Role?: string | null;
    /** Sub-lines the app doesn't model (an OBJE), levels relative to the SOUR line (#976). */
    RawGedcom?: string | null;
    /** 'DATE' or 'PLAC': the citation supports that line of the fact, and exports under it (#990). */
    Part?: string | null;
    /** The link to the record, written as `_LINK` (ADR 0025). */
    Url?: string | null;
}

/** A citation with the files linked to it (#47), as the generator writes it. */
type CitationWithMedia = GedcomExportCitation & {
    /** Each file's media id and the xref of its top-level `OBJE` record. */
    media?: Array<{ id: number; xref: string }>;
};

/** A first-class note exported as a shared `0 @N@ NOTE` record (Slice 1). */
export interface GedcomExportNote {
    Id: number;
    Text: string;
    /**
     * Set only on rows the one-time `People."Notes"` migration created. Such a
     * note belongs to exactly one person, which is what makes it safe to strip
     * legacy `NICK:` / `_AKA:` prefix lines out of its text on export (#524 /
     * ADR 0010) — a note the user shares with a family never has this set.
     */
    BackfilledFromPersonId?: number | null;
}

/** Attaches a note to an owner record via a `<L> NOTE @N@` pointer. */
export interface GedcomExportNoteLink {
    NoteId: number;
    OwnerTable: string;
    OwnerId: number;
    OwnerFact?: 'Birth' | 'Death' | 'Marriage' | null;
}

/** A media row exported as a shared top-level `OBJE` record. */
export interface GedcomExportMedia {
    Id: number;
    Title: string | null;
    /** Not a GEDCOM line: OBJE has no DATE, so it rides in media.json (#802). */
    Date?: string | null;
    FilePath: string | null;
    /** The FILE text an import declared; written back while the bytes are missing (#958). */
    SourceFile?: string | null;
    Format: string | null;
    FocalX?: number | null;
    FocalY?: number | null;
    FocalRadius?: number | null;
    /** FILE sub-lines an import didn't model, levels relative to FILE (#976). */
    FileRawGedcom?: string | null;
}

/** Attaches a media row to an owner record. */
export interface GedcomExportMediaLink {
    MediaId: number;
    OwnerTable: string;
    OwnerId: number;
    /** The vital fact the link is scoped to: exported under that fact's line (ADR 0030). */
    OwnerFact?: 'Birth' | 'Death' | 'Marriage' | null;
    /** Canonical People primary state. */
    IsPrimary: number;
}

export interface GedcomExportExtras {
    sources?: GedcomExportSource[];
    citations?: GedcomExportCitation[];
    /** Source.Id -> @Sn@ xref. If omitted, built from `sources` order. */
    sourceIdToXref?: Map<number, string>;
    /** First-class notes (Slice 1) — emitted as shared `0 @N@ NOTE` records. */
    notes?: GedcomExportNote[];
    /** Note→owner attachments — emitted as `NOTE @N@` pointers on each owner. */
    noteLinks?: GedcomExportNoteLink[];
    /** First-class media — emitted as shared top-level `OBJE` records. */
    media?: GedcomExportMedia[];
    /** Media→owner attachments — emitted as pointer `OBJE` links. */
    mediaLinks?: GedcomExportMediaLink[];
    /** Place name → PLAC.FORM (Slice 5) — emitted as `FORM` under each `PLAC`. */
    placeForms?: Map<string, string>;
    /**
     * Name variants — `Nickname` emits `NICK`, `Alias` emits `_AKA`. The importer
     * promotes those tags into `NameVariant` rows rather than `Notes` text, so the
     * export has to read them back from here or the tags are lost on round-trip.
     */
    nameVariants?: Array<{ Id: number; PersonId: number; Type: string; Name: string }>;
    /**
     * Place name → Places.Id — resolves a place's NoteLink(OwnerTable='Places')
     * rows (already flowing through `notes`/`noteLinks` above, since those are
     * unfiltered by owner table) to the PLAC line for that name, so
     * `pushPlaceNotes` can emit a `NOTE @Nx@` pointer under it.
     */
    placeIdByName?: Map<string, number>;
    /**
     * Repository name → `Repository."Id"`. REPO records are synthesised from the
     * sources' RepositoryName strings, so this is the only way an owner-keyed note
     * link (`Repository:<id>`) can be matched to the record being emitted (ADR 0012).
     */
    repoIdByName?: Map<string, number>;
    /** Repository name → its address and GEDCOM passthrough, for every repository in the tree (#966). */
    repositoryDetails?: Map<string, { Address: string | null; RawGedcom?: string | null; AddressRawGedcom?: string | null }>;
}

// GEDCOM 5.5.1 spec: line length includes level, tag, value, delimiters, AND terminator (CRLF).
// 255 total - 2 for CRLF = 253 usable characters per line.
const MAX_LINE_LENGTH = 253;

/**
 * Person event types that are real GEDCOM tags, so they emit as `1 <TAG>`. Mirrors
 * the parser's own list of event tags promoted to Events rows (`HANDLED_INDI_L1`).
 * Anything else in Events."Type" is a custom event label (from a `1 EVEN` / `2 TYPE`
 * import, ADR 0012) and must emit as `1 EVEN` + `2 TYPE <label>` instead — the same
 * treatment `STD_FAMILY_TAGS` gives the family path. BIRT/DEAT are included because
 * a legacy/API-created Events row of either type still emits its own line when the
 * People column did not.
 */
/**
 * A child relationship type → GEDCOM PEDIGREE_LINKAGE_TYPE. The inverse of the
 * parser's PEDI_TO_RELATIONSHIP_TYPE. Birth is the default, so it is written as
 * no PEDI at all (ADR 0012). Step, Guardian and Unknown have no PEDI value.
 */
const RELATIONSHIP_TYPE_TO_PEDI: Record<string, string | null> = {
    Birth: null,
    Adoption: 'adopted',
    Foster: 'foster',
};

/** One child link as the export reads it, from `FamilyWithRelations.children`. */
interface ChildLinkRecord {
    Partner1Relationship?: string;
    Partner2Relationship?: string;
    FamcRawGedcom?: string | null;
    ChilRawGedcom?: string | null;
}

/** One child link as the person emit needs it: its `2 PEDI` value and FAMC passthrough. */
interface ChildLinkExport {
    pedi: string | null;
    famcRawGedcom?: string | null;
}

/**
 * How a child link's relationship to each partner is written (#982, ADR 0027).
 * When the partners share one value that PEDI can say, it is a `2 PEDI` under the
 * child's `1 FAMC` (none for Birth). Otherwise each partner's value is FTM's
 * `2 _FREL` (HUSB, Partner1) / `2 _MREL` (WIFE, Partner2) under the family's
 * `1 CHIL`, as FTM and Gramps read them. A partner whose tag the link's passthrough
 * already carries (a Private or Sealed value the app has no type for) keeps that
 * line instead, and then the other partner's tag is written too so no value is
 * lost. The file's own PEDI, kept raw (step, sealing), likewise wins over a derived one.
 */
function childLinkRelationshipLines(
    link: ChildLinkRecord,
    present: { partner1: boolean; partner2: boolean },
): { pedi: string | null; chil: string[] } {
    const value = (v: string | undefined) => (isChildRelationshipType(v) ? v : 'Birth');
    const partner1 = value(link.Partner1Relationship);
    const partner2 = value(link.Partner2Relationship);
    const shared = sharedChildRelationship(partner1, partner2, present);
    const rawChil = link.ChilRawGedcom ?? '';
    const rawTag = { partner1: /^2 _FREL\b/m.test(rawChil), partner2: /^2 _MREL\b/m.test(rawChil) };
    const sharedPedi = shared !== null && shared in RELATIONSHIP_TYPE_TO_PEDI ? RELATIONSHIP_TYPE_TO_PEDI[shared] : undefined;
    // The file's own PEDI (step, sealing) holds the FAMC's one PEDI line, so a
    // shared Adoption or Foster then goes out per partner instead.
    const rawPedi = /^2 PEDI\b/m.test(link.FamcRawGedcom ?? '');
    const pedi = sharedPedi && !rawPedi ? sharedPedi : null;
    const chil: string[] = [];
    if (sharedPedi === undefined || (sharedPedi && rawPedi) || rawTag.partner1 || rawTag.partner2) {
        if (present.partner1 && !rawTag.partner1) chil.push(`2 _FREL ${CHILD_RELATIONSHIP_TO_FTM_VALUE[partner1]}`);
        if (present.partner2 && !rawTag.partner2) chil.push(`2 _MREL ${CHILD_RELATIONSHIP_TO_FTM_VALUE[partner2]}`);
    }
    return { pedi, chil };
}

/** Which of a family's partner slots export writes a HUSB / WIFE for. */
function exportedPartners(f: FamilyWithRelations, personIdMap: Map<number, string>): { partner1: boolean; partner2: boolean } {
    return {
        partner1: f.Partner1Id != null && personIdMap.has(f.Partner1Id),
        partner2: f.Partner2Id != null && personIdMap.has(f.Partner2Id),
    };
}

const STD_PERSON_EVENT_TAGS = new Set([
    'BIRT', 'DEAT', 'OCCU', 'EDUC', 'RESI', 'BURI', 'CHR', 'BAPM', 'ADOP', 'EVEN',
    'GRAD', 'EMIG', 'IMMI', 'NATU', 'CENS', 'RETI', 'PROB', 'WILL',
]);

// Only these individual-event structures have a value slot on their level-1
// line. Every other person event is a bare event anchor; free text belongs in
// an EVENT_DETAIL NOTE_STRUCTURE below it (GEDCOM 5.5.1).
const PERSON_EVENT_VALUE_TAGS = new Set(['OCCU', 'EDUC']);

const POINTER_SHAPED_TEXT = /^@[^@\s]+@$/;

/**
 * Splits a long GEDCOM line into the initial line plus CONC continuation lines.
 * CONC joins without a newline break (pure concatenation for long values).
 *
 * Per the spec, CONC splits must occur at a non-space character. If a split
 * lands at the end of a word, the space carries over to the start of the CONC value.
 *
 * concLevel controls where CONC lines are placed. By default it's level + 1
 * (correct for primary tags like NOTE, PLAC). For CONT lines, pass the same
 * level as CONT since CONC and CONT are siblings under the parent tag.
 */
function pushGedcomLine(lines: string[], level: number, tag: string, value: string, concLevel?: number): void {
    // Text shaped like a pointer (TMG titles every source `@R1@`) goes out with
    // its @ doubled, so it isn't read or dropped as a pointer; import reads `@@` as @.
    if (POINTER_SHAPED_TEXT.test(value)) value = value.replace(/@/g, '@@');
    const firstLine = `${level} ${tag} ${value}`;
    if (firstLine.length <= MAX_LINE_LENGTH) {
        lines.push(firstLine);
        return;
    }

    const effectiveConcLevel = concLevel ?? level + 1;
    const prefix = `${level} ${tag} `;
    const concPrefix = `${effectiveConcLevel} CONC `;
    const maxFirstChunk = MAX_LINE_LENGTH - prefix.length;
    const maxConcChunk = MAX_LINE_LENGTH - concPrefix.length;

    // Split first chunk — ensure we don't end on a trailing space
    let splitAt = maxFirstChunk;
    if (splitAt < value.length && value[splitAt] === ' ') {
        // Move split back so trailing space goes to the CONC line
        while (splitAt > 0 && value[splitAt - 1] === ' ') splitAt--;
    }
    lines.push(prefix + value.slice(0, splitAt));

    let offset = splitAt;
    while (offset < value.length) {
        let chunkEnd = offset + maxConcChunk;
        if (chunkEnd < value.length && value[chunkEnd] === ' ') {
            while (chunkEnd > offset && value[chunkEnd - 1] === ' ') chunkEnd--;
        }
        lines.push(concPrefix + value.slice(offset, chunkEnd));
        offset = chunkEnd;
    }
}

/** Emit inline GEDCOM text, preserving both embedded newlines and long lines. */
function pushGedcomText(lines: string[], level: number, tag: string, text: string): void {
    // A lone CR is a line break to the parser too, so it becomes CONT, never raw.
    const textLines = text.split(/\r\n?|\n/);
    pushGedcomLine(lines, level, tag, textLines[0] ?? '');
    for (let i = 1; i < textLines.length; i++) {
        // CONT is a sibling of CONC under the NOTE line. Keep its CONC lines at
        // the same level so a long continuation cannot be mis-nested.
        pushGedcomLine(lines, level + 1, 'CONT', textLines[i], level + 1);
    }
}

/** Which of a fact's citations one `pushCitations` call writes, by the part each cites (#990). */
type CitationFilter = (part: string | null) => boolean;

/** A fact's own citations, plus any DATE or PLAC citation whose line isn't written. */
const factCitations = (date: unknown, place: unknown): CitationFilter =>
    (part) => !(part === 'DATE' && date) && !(part === 'PLAC' && place);

/** The citations of one part of a fact, written under its DATE or PLAC line. */
const partCitations = (want: 'DATE' | 'PLAC'): CitationFilter => (part) => part === want;

/**
 * Emits citation pointers for one fact: `<L> SOUR @Sn@` then `<L+1> PAGE` / `<L+1> NOTE`.
 * `level` is the level of the SOUR line (1 for INDI/FAM-level, 2 for sub-facts, 3 under
 * a fact's DATE or PLAC).
 */
function pushCitations(
    lines: string[],
    level: number,
    factKey: string,
    citationsByFact: Map<string, GedcomExportCitation[]>,
    sourceIdToXref: Map<number, string>,
    select: CitationFilter = () => true,
): void {
    for (const c of citationsByFact.get(factKey) ?? []) {
        const xref = sourceIdToXref.get(c.SourceId);
        if (!xref || !select(c.Part ?? null)) continue;
        lines.push(`${level} SOUR ${xref}`);
        // Free text goes out with CONT for a line break, never as a raw line.
        if (c.Page) pushGedcomText(lines, level + 1, 'PAGE', c.Page);
        // Evidence fields (Slice 3), in spec order: EVEN/ROLE, DATA/DATE/TEXT, QUAY, NOTE.
        if (c.Even) {
            pushGedcomLine(lines, level + 1, 'EVEN', c.Even);
            if (c.Role) pushGedcomLine(lines, level + 2, 'ROLE', c.Role);
        }
        if (c.DataDate || c.DataText) {
            lines.push(`${level + 1} DATA`);
            // Sanitised, not reformatted: a citation's DATA.DATE is stored as the
            // source wrote it, but it is still a DATE line and must not be able to
            // carry a newline that forges further GEDCOM lines.
            if (c.DataDate) pushGedcomLine(lines, level + 2, 'DATE', sanitizeGedcomDateValue(c.DataDate));
            if (c.DataText) pushGedcomText(lines, level + 2, 'TEXT', c.DataText);
        }
        // Before the passthrough, so a second link line kept there stays second
        // and re-import lifts this one again (ADR 0025).
        const url = c.Url?.replace(/[\x00-\x1f\x7f\x85\u2028\u2029]+/g, ' ').trim();
        if (url) pushGedcomLine(lines, level + 1, '_LINK', url);
        // The citation's own files (#47): a MULTIMEDIA_LINK under the SOURCE_CITATION.
        // One a passthrough line still names (a tree imported before #47) goes out there.
        for (const m of (c as CitationWithMedia).media ?? []) {
            if (!c.RawGedcom?.includes(`OBJE @~O:${m.id}@`)) lines.push(`${level + 1} OBJE ${m.xref}`);
        }
        pushRaw(lines, c.RawGedcom, level);
        if (c.Quay) pushGedcomLine(lines, level + 1, 'QUAY', c.Quay);
        if (c.Note) pushGedcomText(lines, level + 1, 'NOTE', c.Note);
    }
}

/**
 * The key a fact's place is looked up under in the FORM / MAP / NOTE maps: its
 * place id as `#<id>` when it has one, since two places may share a name (#1186),
 * else its text.
 */
function placeLookupKey(place: string | null | undefined, placeId: number | null | undefined): string | null {
  const key = factPlaceKey(place, placeId);
  return key == null ? null : placeKeyString(key);
}

/**
 * Emits a PLAC.MAP sub-structure when coords are provided and the place is known.
 * `level` is the level of the MAP line (one above LATI/LONG).
 */
function pushPlaceMap(
  lines: string[],
  level: number,
  place: string | null | undefined,
  coords?: Map<string, { lat: number; lng: number }>,
): void {
  if (!place || !coords) return;
  const c = coords.get(place);
  if (!c) return;
  const { lati, long } = gedcomLatLng(c.lat, c.lng);
  lines.push(`${level} MAP`);
  lines.push(`${level + 1} LATI ${lati}`);
  lines.push(`${level + 1} LONG ${long}`);
}

/** Emit a `FORM` jurisdiction format under a PLAC when known (Slice 5). */
function pushPlaceForm(
  lines: string[],
  level: number,
  place: string | null | undefined,
  placeForms?: Map<string, string>,
): void {
  if (!place || !placeForms) return;
  const form = placeForms.get(place);
  if (form) pushGedcomLine(lines, level, 'FORM', form);
}

/** Emit a `NOTE @Nx@` pointer under a PLAC for each note attached to that place. */
function pushPlaceNotes(
  lines: string[],
  level: number,
  place: string | null | undefined,
  placeNoteIds?: Map<string, number[]>,
  xrefForNote?: (id: number) => string,
): void {
  if (!place || !placeNoteIds || !xrefForNote) return;
  const ids = placeNoteIds.get(place);
  if (!ids) return;
  for (const id of ids) {
    lines.push(`${level} NOTE ${xrefForNote(id)}`);
  }
}

/**
 * Map each person's DB id to their INDI xref. A stored `GedcomId` is preserved
 * when it is a well-formed, unique `@I…@` token; merge re-import matches an
 * imported person to an existing row by stored GedcomId, so renumbering everyone
 * breaks a self-export → merge-reimport round-trip. People with no stored id, a
 * duplicate id, or a non-`@I` token get a fresh `@In@` that avoids every xref
 * already taken.
 *
 * Exported because `gedcom-export.ts` needs the SAME mapping to write person
 * pointers into cases.json / media.json / sources.json. Re-deriving it there is
 * how those sidecars silently desynced from the .ged.
 */
export function assignPersonXrefs(
    people: Array<{ Id: number; GedcomId: string | null }>,
): Map<number, string> {
    const INDI_XREF = /^@I[A-Za-z0-9]+@$/;
    const gedcomIdCounts = new Map<string, number>();
    for (const p of people) {
        if (p.GedcomId) gedcomIdCounts.set(p.GedcomId, (gedcomIdCounts.get(p.GedcomId) ?? 0) + 1);
    }
    const usable = (g: string | null): g is string =>
        !!g && INDI_XREF.test(g) && gedcomIdCounts.get(g) === 1;

    const takenXrefs = new Set<string>();
    for (const p of people) {
        if (usable(p.GedcomId)) takenXrefs.add(p.GedcomId);
    }
    let pIndex = 1;
    const nextFreeXref = (): string => {
        let xref: string;
        do {
            xref = `@I${pIndex++}@`;
        } while (takenXrefs.has(xref));
        takenXrefs.add(xref);
        return xref;
    };

    const map = new Map<number, string>();
    for (const p of people) {
        map.set(p.Id, usable(p.GedcomId) ? p.GedcomId : nextFreeXref());
    }
    return map;
}

/**
 * Family xrefs, `@F1@` on in the order the families are written. Exported for the
 * places.json record map, which has to name each family as the .ged does (#1186).
 */
export function assignFamilyXrefs(families: Array<{ Id: number }>): Map<number, string> {
    return new Map(families.map((f, index) => [f.Id, `@F${index + 1}@`]));
}

/** Assign deterministic top-level multimedia xrefs in ascending Media ID order. */
export function assignMediaXrefs(media: Array<{ Id: number }>): Map<number, string> {
    return new Map([...media].sort((a, b) => a.Id - b.Id).map((item, index) => [item.Id, `@O${index + 1}@`]));
}

/**
 * Generates a GEDCOM 5.5.1 file from people and families data.
 * Pass an optional `coords` map (place name → lat/lng) to emit PLAC.MAP
 * sub-structures for geocoded places.
 */
export function generateGedcom(
  people: PersonWithRelations[],
  families: FamilyWithRelations[],
  coords?: Map<string, { lat: number; lng: number }>,
  extras?: GedcomExportExtras,
): string {
    return generateGedcomWithReport(people, families, coords, extras).gedcom;
}

/** What the generator left out of the file, for the export's media summary. */
interface GedcomGenerationReport {
    gedcom: string;
    /** Passthrough `OBJE` pointers from before #979 that name no image this export can trust (ADR 0030). */
    staleMediaPointers: number;
}

/** {@link generateGedcom}, plus what it had to leave out. */
export function generateGedcomWithReport(
  people: PersonWithRelations[],
  families: FamilyWithRelations[],
  coords?: Map<string, { lat: number; lng: number }>,
  extras?: GedcomExportExtras,
): GedcomGenerationReport {
    const lines: string[] = [];

    // Header
    lines.push('0 HEAD');
    lines.push('1 SOUR GenealogyApp');
    lines.push('1 GEDC');
    lines.push('2 VERS 5.5.1');
    lines.push('2 FORM LINEAGE-LINKED');
    lines.push('1 CHAR UTF-8');
    lines.push('1 SUBM @SUBM@');

    // Submitter record (required by GEDCOM 5.5.1)
    lines.push('0 @SUBM@ SUBM');
    lines.push('1 NAME GenealogyApp User');

    // Map internal IDs to GEDCOM xrefs (person assignment preserves stored GedcomIds
    // where safe — see the personIdMap loop below).
    const personIdMap = new Map<number, string>();
    const familyIdMap = new Map<number, string>();

    // Source xref map (reuse caller's so cases.json / sources.json agree).
    const sources = extras?.sources ?? [];
    const sourceIdToXref = extras?.sourceIdToXref ?? new Map<number, string>();
    if (extras?.sources && !extras.sourceIdToXref) {
        sources.forEach((s, i) => sourceIdToXref.set(s.Id, `@S${i + 1}@`));
    }
    // Citations grouped by `${FactTable}:${FactId}` for fast lookup during record gen.
    const citationsByFact = new Map<string, GedcomExportCitation[]>();
    for (const c of extras?.citations ?? []) {
        const key = `${c.FactTable}:${c.FactId}`;
        const list = citationsByFact.get(key) ?? [];
        list.push(c);
        citationsByFact.set(key, list);
    }

    // First-class notes (Slice 1): emit a shared `0 @Nn@ NOTE` record for every
    // referenced note, People included (ADR 0010 / #407). People used to be excluded
    // here on the reasoning that person notes emit inline from p.Notes — but
    // generatePersonRecord never looked up its own owner key, so a People-owned Note
    // had no path out at all. The inline emit survives only as a fallback for a
    // person with no first-class note; see generatePersonRecord.
    const noteTextById = new Map<number, string>();
    for (const n of extras?.notes ?? []) noteTextById.set(n.Id, n.Text);

    // Owners hold note IDs, not xrefs, and `@Nn@` is minted on first EMISSION
    // (#405 / ADR 0015). Numbering used to come from the position of each note in
    // `extras.notes`, which `getNotesForTree` orders by `Note."Id"` — and row ids
    // reflect when the user happened to create each note, while a reimport
    // re-creates them in emission order. So the same tree exported, reimported and
    // re-exported permuted its labels. First-reference order is invariant under
    // that cycle because record order is.
    //
    // Mint where you emit, never where you probe: `.get()` deliberately does NOT
    // allocate, so the REPO existence check below cannot silently claim `@N1@`.
    // #524 / ADR 0010 — legacy nicknames, now that People."Notes" is gone.
    //
    // Imports predating the NameVariant promotion stored nicknames as literal
    // "NICK: Bill" TEXT inside the column, and the one-time init-schema backfill
    // mirrored that text verbatim into a Note row. The column used to be the place
    // this was read from; with it dropped, the backfilled note is the only copy, so
    // the extraction is re-pointed there rather than deleted (ADR 0010 forbids
    // silently dropping it).
    //
    // Scoped to BACKFILLED notes only. `BackfilledFromPersonId` is set solely by
    // that migration, so such a note belongs to exactly one person and stripping
    // its text cannot mutate a note the user shares with a family.
    //
    // Rewriting `noteTextById` here — before owners or xrefs are built — is what
    // makes one pass enough: the person's `1 NOTE @Nn@` pointer and the shared
    // `0 @Nn@ NOTE` record both read this map, so neither can re-emit the prefix.
    const legacyNameTags = new Map<number, Array<{ type: 'Nickname' | 'Alias'; name: string }>>();
    const strippedEmpty = new Set<number>();
    for (const n of extras?.notes ?? []) {
        if (n.BackfilledFromPersonId === null || n.BackfilledFromPersonId === undefined) continue;
        if (!n.Text.includes('NICK: ') && !n.Text.includes('_AKA: ')) continue;
        const kept: string[] = [];
        const tags = legacyNameTags.get(n.BackfilledFromPersonId) ?? [];
        for (const line of n.Text.split('\n')) {
            if (line.startsWith('NICK: ')) tags.push({ type: 'Nickname', name: line.slice(6) });
            else if (line.startsWith('_AKA: ')) tags.push({ type: 'Alias', name: line.slice(6) });
            else kept.push(line);
        }
        if (tags.length > 0) legacyNameTags.set(n.BackfilledFromPersonId, tags);
        const remaining = kept.join('\n');
        // A note that was ONLY prefix lines has no body left. Emitting it would put
        // an empty `0 @Nn@ NOTE` record in the file and a pointer to nothing.
        if (remaining.trim() === '') strippedEmpty.add(n.Id);
        else noteTextById.set(n.Id, remaining);
    }

    const noteIdsByOwner = new Map<string, number[]>();
    const noteIdsByFact = new Map<string, number[]>();
    for (const l of extras?.noteLinks ?? []) {
        if (!noteTextById.has(l.NoteId)) continue; // link to a note that no longer exists
        if (strippedEmpty.has(l.NoteId)) continue; // nothing left after tag extraction
        if (l.OwnerFact) {
            const key = `${l.OwnerTable}:${l.OwnerId}:${l.OwnerFact}`;
            const arr = noteIdsByFact.get(key) ?? [];
            arr.push(l.NoteId);
            noteIdsByFact.set(key, arr);
            continue;
        }
        const key = `${l.OwnerTable}:${l.OwnerId}`;
        const arr = noteIdsByOwner.get(key) ?? [];
        arr.push(l.NoteId);
        noteIdsByOwner.set(key, arr);
    }

    // Insertion order IS the emission order, so this doubles as the record-emit
    // list at the end of the file.
    const noteIdToXref = new Map<number, string>();
    const xrefForNote = (id: number): string => {
        let xref = noteIdToXref.get(id);
        if (!xref) {
            xref = `@N${noteIdToXref.size + 1}@`;
            noteIdToXref.set(id, xref);
        }
        return xref;
    };

    // Resolve each place's NoteLink ids (OwnerTable='Places') to its name, so
    // pushPlaceNotes can look them up by the same place-string key used for
    // FORM/MAP (round-trips GEDCOM PLACE_STRUCTURE's NOTE_STRUCTURE).
    const placeNoteIds = new Map<string, number[]>();
    for (const [name, id] of extras?.placeIdByName ?? []) {
        const ids = noteIdsByOwner.get(`Places:${id}`);
        if (ids) placeNoteIds.set(name, ids);
    }

    // First-class media: every `extras.media` row receives one deterministic
    // top-level identity; owners below emit only pointers from `MediaLink`.
    // Legacy inline media remains an input/parser compatibility contract, not an
    // exporter output path.
    const mediaById = new Map<number, GedcomExportMedia>();
    for (const m of extras?.media ?? []) mediaById.set(m.Id, m);
    const mediaXrefById = assignMediaXrefs(extras?.media ?? []);
    const mediaByOwner = new Map<string, GedcomExportMediaLink[]>();
    const primaryPeopleByMedia = new Map<number, number[]>();
    const primaryFamiliesByMedia = new Map<number, number[]>();
    for (const l of extras?.mediaLinks ?? []) {
        if (!mediaById.has(l.MediaId)) continue;
        if (!['People', 'Families', 'Sources', 'Events', 'Citation'].includes(l.OwnerTable)) continue;
        // A fact's links are keyed by the fact too, as fact notes are, so they emit
        // under that fact's line and never as the record's own `1 OBJE`.
        const key = l.OwnerFact ? `${l.OwnerTable}:${l.OwnerId}:${l.OwnerFact}` : `${l.OwnerTable}:${l.OwnerId}`;
        const arr = mediaByOwner.get(key) ?? [];
        arr.push(l);
        mediaByOwner.set(key, arr);
        if (l.OwnerTable === 'People' && l.IsPrimary === 1) {
            const people = primaryPeopleByMedia.get(l.MediaId) ?? [];
            people.push(l.OwnerId);
            primaryPeopleByMedia.set(l.MediaId, people);
        }
        // A family photo (#119, ADR 0047) is the same owner-specific pointer, to an @F…@.
        if (l.OwnerTable === 'Families' && !l.OwnerFact && l.IsPrimary === 1) {
            const families = primaryFamiliesByMedia.get(l.MediaId) ?? [];
            families.push(l.OwnerId);
            primaryFamiliesByMedia.set(l.MediaId, families);
        }
    }
    // A citation's files ride on the citation, written under its SOUR line (#47).
    for (const [key, list] of citationsByFact) {
        citationsByFact.set(key, list.map((c): CitationWithMedia => {
            const links = c.Id == null ? undefined : mediaByOwner.get(`Citation:${c.Id}`);
            if (!links) return c;
            const media = links.flatMap((l) => {
                const xref = mediaXrefById.get(l.MediaId);
                return xref ? [{ id: l.MediaId, xref }] : [];
            });
            return media.length ? { ...c, media } : c;
        }));
    }
    // (replaces the inlined INDI_XREF / takenXrefs / nextFreeXref block)
    for (const [dbId, xref] of assignPersonXrefs(people)) {
        personIdMap.set(dbId, xref);
    }

    for (const [dbId, xref] of assignFamilyXrefs(families)) {
        familyIdMap.set(dbId, xref);
    }

    const placeForms = extras?.placeForms;

    // Name variants grouped per person, so each INDI can emit its own NICK / _AKA.
    const nameVariantsByPerson = new Map<number, Array<{ Id: number; Type: string; Name: string }>>();
    for (const nv of extras?.nameVariants ?? []) {
        const list = nameVariantsByPerson.get(nv.PersonId);
        if (list) list.push(nv);
        else nameVariantsByPerson.set(nv.PersonId, [nv]);
    }

    // Per-child pedigree linkage and FAMC passthrough, keyed `${familyId}:${personId}`.
    // Both are stored on the FamilyPerson join (family side), but GEDCOM records
    // them under the CHILD's own `1 FAMC` (ADR 0012, #954), so the person emit
    // needs them looked up from here.
    const childLinkByLink = new Map<string, ChildLinkExport>();
    for (const f of families) {
        const present = exportedPartners(f, personIdMap);
        for (const child of f.children ?? []) {
            const { pedi } = childLinkRelationshipLines(child, present);
            if (pedi || child.FamcRawGedcom) {
                childLinkByLink.set(`${f.Id}:${child.Id}`, { pedi, famcRawGedcom: child.FamcRawGedcom });
            }
        }
    }

    // Generate person records
    for (const p of people) {
        generatePersonRecord(lines, p, personIdMap, familyIdMap, coords, citationsByFact, sourceIdToXref, noteIdsByOwner, noteIdsByFact, xrefForNote, mediaByOwner, mediaXrefById, placeForms, placeNoteIds, nameVariantsByPerson, childLinkByLink, legacyNameTags);
    }

    // Generate family records
    for (const f of families) {
        generateFamilyRecord(lines, f, personIdMap, familyIdMap, coords, citationsByFact, sourceIdToXref, noteIdsByOwner, noteIdsByFact, xrefForNote, mediaByOwner, mediaXrefById, placeForms, placeNoteIds);
    }

    // Source + repository records. A repository can carry a note without any source
    // referencing it (the importer creates one for a note-bearing REPO record on
    // purpose — ADR 0012), so the gate covers repositories too; otherwise that note
    // would be emitted as an orphan `0 @Nn@ NOTE` with nothing pointing at it and
    // be dropped on the next import.
    // Repository.Id → the xref this file gives its REPO record, for kept pointers (#985).
    const repoXrefById = new Map<number, string>();
    if (sources.length > 0 || (extras?.repoIdByName?.size ?? 0) > 0) {
        const repoNameToXref = new Map<string, string>();
        const repoNameToAddr = new Map<string, string>(); // Slice 4 — first address seen per repo
        let rIndex = 1;
        // Seed from every repository in the tree, so one no source cites still gets
        // its own `0 @Rn@ REPO` record below (#966), and so does its note: labels
        // are minted on emission (#405), and a note whose only owner never reaches
        // the file never mints.
        for (const [name, id] of extras?.repoIdByName ?? []) {
            const xref = `@R${rIndex++}@`;
            repoNameToXref.set(name, xref);
            repoXrefById.set(id, xref);
        }
        for (const s of sources) {
            const xref = sourceIdToXref.get(s.Id);
            if (!xref) continue;
            lines.push(`0 ${xref} SOUR`);
            if (s.Title) pushGedcomLine(lines, 1, 'TITL', s.Title);
            // ABBR follows TITL — it is the short FILING form of that title
            // (SOURCE_FILED_BY_ENTRY, ged551-4.txt:82). Modeled as of #501, so it no
            // longer rides RawGedcom passthrough; emitted here exactly once.
            if (s.Abbreviation) pushGedcomLine(lines, 1, 'ABBR', s.Abbreviation);
            if (s.Author) pushGedcomLine(lines, 1, 'AUTH', s.Author);
            if (s.PublicationInfo) pushGedcomLine(lines, 1, 'PUBL', s.PublicationInfo);
            if (s.Contents) {
                const textLines = s.Contents.split('\n').map((l) => l.replace(/\r$/, ''));
                pushGedcomLine(lines, 1, 'TEXT', textLines[0]);
                for (let i = 1; i < textLines.length; i++) pushGedcomLine(lines, 2, 'CONT', textLines[i], 2);
            }
            if (s.Text) pushGedcomLine(lines, 1, '_URL', s.Text);
            if (s.Type) pushGedcomLine(lines, 1, '_TYPE', s.Type);
            if (s.Num != null) lines.push(`1 _NUM ${s.Num}`);
            if (s.RepositoryName) {
                let repoXref = repoNameToXref.get(s.RepositoryName);
                if (!repoXref) {
                    repoXref = `@R${rIndex++}@`;
                    repoNameToXref.set(s.RepositoryName, repoXref);
                }
                lines.push(`1 REPO ${repoXref}`);
                if (s.CallNumber) {
                    pushGedcomLine(lines, 2, 'CALN', s.CallNumber);
                    if (s.RepositoryMedi) pushGedcomLine(lines, 3, 'MEDI', s.RepositoryMedi);
                }
                if (s.RepositoryAddress && !repoNameToAddr.has(s.RepositoryName)) {
                    repoNameToAddr.set(s.RepositoryName, s.RepositoryAddress);
                }
            }
            // Shared-note pointers attached to this source (Slice 1).
            for (const noteId of noteIdsByOwner.get(`Sources:${s.Id}`) ?? []) {
                lines.push(`1 NOTE ${xrefForNote(noteId)}`);
            }
            // Media attached to this source — pointer-only owner link.
            pushMediaPointers(lines, mediaByOwner.get(`Sources:${s.Id}`) ?? [], mediaXrefById);
            // Passthrough: re-emit verbatim source subtrees not modeled by the importer.
            pushRaw(lines, s.RawGedcom);
        }
        // Emit the deduped REPO records. These are synthesised from the sources'
        // RepositoryName strings, so a note link — keyed on a real Repository row id
        // — has to be resolved through the name → id map the export service supplies.
        // Safe as a join key: Repository is unique per (TreeId, Name).
        for (const [name, xref] of repoNameToXref) {
            lines.push(`0 ${xref} REPO`);
            pushGedcomLine(lines, 1, 'NAME', name);
            const details = extras?.repositoryDetails?.get(name);
            const addr = details?.Address ?? repoNameToAddr.get(name);
            if (addr || details?.AddressRawGedcom) {
                // A multi-line address continues on CONT lines; ADR1, CITY, … follow (#966).
                const [first, ...rest] = (addr ?? '').split(/\r\n?|\n/);
                if (first) pushGedcomLine(lines, 1, 'ADDR', first);
                else lines.push('1 ADDR');
                for (const line of rest) pushGedcomLine(lines, 2, 'CONT', line);
                pushRaw(lines, details?.AddressRawGedcom);
            }
            // REPOSITORY_RECORD +1 <<NOTE_STRUCTURE>>, after NAME/ADDR per the spec's
            // own ordering (ged551-2.txt:227-232).
            const repoId = extras?.repoIdByName?.get(name);
            if (repoId !== undefined) {
                for (const noteId of noteIdsByOwner.get(`Repository:${repoId}`) ?? []) {
                    lines.push(`1 NOTE ${xrefForNote(noteId)}`);
                }
            }
            // Passthrough: PHON, EMAIL, WWW, CHAN, … as the file had them (#966).
            pushRaw(lines, details?.RawGedcom);
        }
    }

    // Shared multimedia records are emitted exactly once, including ownerless
    // library rows. Primary state is represented only by owner-specific person
    // xrefs on the top-level record; never by `_PRIM Y/N` here.
    for (const m of [...mediaById.values()].sort((a, b) => a.Id - b.Id)) {
        const xref = mediaXrefById.get(m.Id);
        if (!xref) continue;
        const primaryPeople = (primaryPeopleByMedia.get(m.Id) ?? [])
            .map((id) => personIdMap.get(id))
            .filter((id): id is string => !!id);
        const primaryFamilies = (primaryFamiliesByMedia.get(m.Id) ?? [])
            .map((id) => familyIdMap.get(id))
            .filter((id): id is string => !!id);
        pushTopLevelMediaRecord(lines, m, xref, [...primaryPeople, ...primaryFamilies]);
    }

    // Passthrough pointers are stored as record ids (#979): name each record by the
    // xref this file gave it. Runs before the NOTE records, so a note that only a
    // passthrough line points at is still minted and emitted.
    const xrefOfRecord: Record<RawPointerKind, (id: number) => string | undefined> = {
        S: (id) => sourceIdToXref.get(id),
        N: (id) => (noteTextById.has(id) ? xrefForNote(id) : undefined),
        O: (id) => mediaXrefById.get(id),
        I: (id) => personIdMap.get(id),
        F: (id) => familyIdMap.get(id),
        R: (id) => repoXrefById.get(id),
    };
    const staleMediaPointers = countStaleMediaPointers(lines);
    const resolved = resolveRawPointerTokens(lines, (kind, id) => xrefOfRecord[kind](id));
    lines.length = 0;
    for (const line of resolved) lines.push(line);

    // First-class NOTE records (Slice 1): one `0 @Nn@ NOTE` per shared note, in
    // the same xref order used for the pointers emitted above.
    // Insertion order == first-reference order, so labels ascend down the file.
    // A note whose only owners were never emitted was never minted, so it produces
    // no dangling `0 @Nn@ NOTE` record with nothing pointing at it.
    for (const [noteId, xref] of noteIdToXref) {
        pushNoteRecord(lines, xref, noteTextById.get(noteId) ?? '');
    }

    // Trailer
    lines.push('0 TRLR');

    // A pointer to a record this file doesn't define (passthrough from before
    // #979, or a record left out of the export) would dangle.
    // Last resort: a line break left inside a value would start a forged line on
    // import, so whatever slipped past the CONT writers goes out as a space.
    const gedcom = dropDanglingPointers(lines).map((line) => line.replace(/[\r\n]+/g, ' ')).join('\n') + '\n';
    return { gedcom, staleMediaPointers };
}

/** Emit a standalone `0 @Nn@ NOTE` record, CONT-splitting multi-line text. */
function pushNoteRecord(lines: string[], xref: string, text: string): void {
    const textLines = text.split('\n').map((l) => l.replace(/\r$/, ''));
    pushGedcomLine(lines, 0, `${xref} NOTE`, textLines[0] ?? '');
    for (let i = 1; i < textLines.length; i++) {
        pushGedcomLine(lines, 1, 'CONT', textLines[i], 1);
    }
}

/** NameVariant types exported as `1 NAME` + `2 TYPE` (GEDCOM NAME_TYPE, #872). */
const VARIANT_TO_NAME_TYPE: Record<string, string> = {
    Maiden: 'maiden',
    Married: 'married',
    Anglicized: 'immigrant',
};

/**
 * Generates a GEDCOM person (INDI) record
 */
function generatePersonRecord(
    lines: string[],
    p: PersonWithRelations,
    personIdMap: Map<number, string>,
    familyIdMap: Map<number, string>,
    coords: Map<string, { lat: number; lng: number }> | undefined,
    citationsByFact: Map<string, GedcomExportCitation[]>,
    sourceIdToXref: Map<number, string>,
    noteIdsByOwner: Map<string, number[]>,
    noteIdsByFact: Map<string, number[]>,
    xrefForNote: (id: number) => string,
    mediaByOwner: Map<string, GedcomExportMediaLink[]>,
    mediaXrefById: Map<number, string>,
    placeForms?: Map<string, string>,
    placeNoteIds?: Map<string, number[]>,
    nameVariantsByPerson?: Map<number, Array<{ Id: number; Type: string; Name: string }>>,
    childLinkByLink?: Map<string, ChildLinkExport>,
    /** Legacy `NICK:`/`_AKA:` text recovered from backfilled notes (#524). */
    legacyNameTags?: Map<number, Array<{ type: 'Nickname' | 'Alias'; name: string }>>,
): void {
    const gedcomId = personIdMap.get(p.Id)!;
    lines.push(`0 ${gedcomId} INDI`);
    lines.push(`1 NAME ${p.FirstName || ''} /${p.LastName || ''}/`);
    // Explicit name pieces (Q7). The slashes in "1 NAME" force every receiving
    // application to re-derive the split, which degrades for compound surnames,
    // surname prefixes and given names containing a space. GIVN/SURN are {0:1}
    // each under NAME (ged551-2.txt:620-635) and say it outright. Omitted rather
    // than emitted blank when the column is empty.
    if (p.FirstName) pushGedcomLine(lines, 2, 'GIVN', p.FirstName);
    if (p.LastName) pushGedcomLine(lines, 2, 'SURN', p.LastName);
    // NICK is a NAME piece in 5.5.1 (no level-1 NICK), so a nickname goes under the
    // primary name. One with its own citations keeps `1 NICK` / `2 SOUR` below (#963).
    const nicknamesUnderName = new Set<number>();
    for (const nv of nameVariantsByPerson?.get(p.Id) ?? []) {
        if (nv.Type !== 'Nickname' || citationsByFact.has(`NameVariant:${nv.Id}`)) continue;
        pushGedcomLine(lines, 2, 'NICK', nv.Name);
        nicknamesUnderName.add(nv.Id);
    }
    // Passthrough: the NAME pieces the app doesn't model (NPFX, NSFX, SPFX, TYPE, …) (#964).
    pushRaw(lines, p.NameRawGedcom);
    pushCitations(lines, 2, `PersonName:${p.Id}`, citationsByFact, sourceIdToXref);

    if (p.Sex) {
        lines.push(`1 SEX ${p.Sex}`);
    }

    // Birth
    let emittedBirtFromColumn = false;
    const hasBirthCitation = citationsByFact.has(`PersonBirth:${p.Id}`);
    const hasBirthFactContent = (noteIdsByFact.get(`People:${p.Id}:Birth`)?.length ?? 0) > 0
        || hasMediaPointers(mediaByOwner.get(`People:${p.Id}:Birth`), mediaXrefById)
        || Boolean(p.BirthRawGedcom);
    if (p.BirthRecorded && !(p.BirthDate || p.BirthPlace || hasBirthCitation || hasBirthFactContent)
        && !p.events?.some((e) => e.Type === 'BIRT')) {
        // Born, with nothing more known (#968). Not when a legacy BIRT event will
        // carry the real date below, as for a flag-only death.
        lines.push('1 BIRT Y');
    }
    if (p.BirthDate || p.BirthPlace || hasBirthCitation || hasBirthFactContent) {
        emittedBirtFromColumn = true;
        lines.push('1 BIRT');
        if (p.BirthDate) {
            lines.push(`2 DATE ${formatDateForGedcom(p.BirthDate)}`);
            pushCitations(lines, 3, `PersonBirth:${p.Id}`, citationsByFact, sourceIdToXref, partCitations('DATE'));
        }
        if (p.BirthPlace) {
            pushGedcomLine(lines, 2, 'PLAC', p.BirthPlace);
            pushPlaceForm(lines, 3, placeLookupKey(p.BirthPlace, p.BirthPlaceId), placeForms);
            pushPlaceMap(lines, 3, placeLookupKey(p.BirthPlace, p.BirthPlaceId), coords);
            pushPlaceNotes(lines, 3, placeLookupKey(p.BirthPlace, p.BirthPlaceId), placeNoteIds, xrefForNote);
            pushCitations(lines, 3, `PersonBirth:${p.Id}`, citationsByFact, sourceIdToXref, partCitations('PLAC'));
        }
        pushCitations(lines, 2, `PersonBirth:${p.Id}`, citationsByFact, sourceIdToXref, factCitations(p.BirthDate, p.BirthPlace));
        for (const noteId of noteIdsByFact.get(`People:${p.Id}:Birth`) ?? []) lines.push(`2 NOTE ${xrefForNote(noteId)}`);
        pushMediaPointers(lines, mediaByOwner.get(`People:${p.Id}:Birth`) ?? [], mediaXrefById, 2);
        // Passthrough: re-emit verbatim BIRT sub-tags the importer did not model (#423).
        pushRaw(lines, p.BirthRawGedcom);
    }

    // Death
    let emittedDeatFromColumn = false;
    const hasDeathCitation = citationsByFact.has(`PersonDeath:${p.Id}`);
    const hasDeathFactContent = (noteIdsByFact.get(`People:${p.Id}:Death`)?.length ?? 0) > 0
        || hasMediaPointers(mediaByOwner.get(`People:${p.Id}:Death`), mediaXrefById)
        || Boolean(p.DeathRawGedcom);
    if (p.DeathDate || p.DeathPlace || p.DeathCause || hasDeathFactContent) {
        emittedDeatFromColumn = true;
        lines.push(p.IsDeceased === 1 && !p.DeathDate && !p.DeathPlace && !p.DeathCause && !p.DeathRawGedcom
            ? '1 DEAT Y'
            : '1 DEAT');
        if (p.DeathDate) {
            lines.push(`2 DATE ${formatDateForGedcom(p.DeathDate)}`);
            pushCitations(lines, 3, `PersonDeath:${p.Id}`, citationsByFact, sourceIdToXref, partCitations('DATE'));
        }
        if (p.DeathPlace) {
            pushGedcomLine(lines, 2, 'PLAC', p.DeathPlace);
            pushPlaceForm(lines, 3, placeLookupKey(p.DeathPlace, p.DeathPlaceId), placeForms);
            pushPlaceMap(lines, 3, placeLookupKey(p.DeathPlace, p.DeathPlaceId), coords);
            pushPlaceNotes(lines, 3, placeLookupKey(p.DeathPlace, p.DeathPlaceId), placeNoteIds, xrefForNote);
            pushCitations(lines, 3, `PersonDeath:${p.Id}`, citationsByFact, sourceIdToXref, partCitations('PLAC'));
        }
        if (p.DeathCause) {
            pushGedcomLine(lines, 2, 'CAUS', p.DeathCause);
        }
        pushCitations(lines, 2, `PersonDeath:${p.Id}`, citationsByFact, sourceIdToXref, factCitations(p.DeathDate, p.DeathPlace));
        for (const noteId of noteIdsByFact.get(`People:${p.Id}:Death`) ?? []) lines.push(`2 NOTE ${xrefForNote(noteId)}`);
        pushMediaPointers(lines, mediaByOwner.get(`People:${p.Id}:Death`) ?? [], mediaXrefById, 2);
        // Passthrough: re-emit verbatim DEAT sub-tags the importer did not model, e.g.
        // CAUS (cause of death) — the headline case #423 exists for.
        pushRaw(lines, p.DeathRawGedcom);
    } else if ((p.IsDeceased === 1 || hasDeathCitation) && !(p.events?.some((e) => e.Type === 'DEAT'))) {
        // Flag-only death (no column date/place). Skip it when a DEAT *event*
        // will carry the real DATE/PLAC below — emitting "1 DEAT Y" here would set
        // emittedDeatFromColumn and suppress the dated event, losing its date on
        // export. This keeps a promoted death (empty column + DEAT event, IsDeceased
        // still 1) exporting exactly one dated "1 DEAT". After promotion PersonDeath
        // citations are re-pointed onto the event, so none are dropped here.
        emittedDeatFromColumn = true;
        lines.push(p.IsDeceased === 1 ? '1 DEAT Y' : '1 DEAT');
        pushCitations(lines, 2, `PersonDeath:${p.Id}`, citationsByFact, sourceIdToXref);
        pushRaw(lines, p.DeathRawGedcom);
    } else if (p.IsDeceased === 0) {
        // Explicitly living. 5.5.1 has no negative-assertion structure and
        // explicitly forbids using an N value for one: "A N(o) value must not be
        // used on an event tag line to assert that the event never happened. This
        // requires the definition of a different tag" (ged551-4.txt:409-410).
        // Our previous "1 DEAT N" read as a death to any conforming importer.
        // A custom tag is legal at level 1 given the leading underscore
        // (ged551-2.txt:42-43). GEDCOM 7 later defined this properly as "1 NO DEAT".
        lines.push('1 _LIVING Y');
    }

    // Events
    if (p.events) {
        for (const evt of p.events) {
            // BIRT/DEAT are column-owned above (:462-495, Option A source of truth) when
            // the column actually emitted a line — skip a stray Events row of either type
            // in that case to avoid a duplicate emit. If the column was empty (e.g. a
            // legacy/API-created BIRT/DEAT Events row with no corresponding column data),
            // fall through so the event itself is still emitted (no silent data loss).
            if (evt.Type === 'BIRT' && emittedBirtFromColumn) continue;
            if (evt.Type === 'DEAT' && emittedDeatFromColumn) continue;
            // A standard tag emits directly; anything else is a custom event and
            // rides on a generic `1 EVEN` + `2 TYPE <label>`, mirroring the family
            // path below. Emitting a custom label as the tag itself would produce a
            // malformed line (`1 Land Lease` re-imports as tag "Land"). The label
            // reaches Events."Type" via the parser's own `2 TYPE` case (ADR 0012).
            const std = STD_PERSON_EVENT_TAGS.has(evt.Type);
            const eventTag = std ? evt.Type : 'EVEN';
            const hasValueSlot = std && PERSON_EVENT_VALUE_TAGS.has(evt.Type);
            // OCCU/EDUC are the only person-event forms where Description is the
            // event's legal level-1 value. All other tags are bare anchors, with
            // the legacy free text retained as an inline NOTE instead of being
            // discarded or exported as malformed GEDCOM.
            if (hasValueSlot && evt.Description) pushGedcomLine(lines, 1, eventTag, evt.Description);
            else lines.push(`1 ${eventTag}`);
            if (!std) pushGedcomLine(lines, 2, 'TYPE', evt.Type);
            if (!hasValueSlot && evt.Description) pushGedcomText(lines, 2, 'NOTE', evt.Description);
            if (evt.Date) {
                // Must match the family-event path (formatDateForGedcom below): one
                // column, one serialisation. Emitting the stored value raw produced
                // `2 DATE 1960-08-09`, which is not a DATE_GREG (`<DAY> <MONTH> <YEAR>`,
                // MONTH in JAN..DEC — GEDCOM 5.5.1 §DATE_GREG/MONTH), and since the
                // parser stores event dates verbatim it also left "Events"."Date" with
                // mixed ISO/GEDCOM formats after a round trip. The helper is identity on
                // values it cannot parse and idempotent on already-formatted ones, so
                // pre-existing rows in either format survive unchanged.
                lines.push(`2 DATE ${formatDateForGedcom(evt.Date)}`);
                pushCitations(lines, 3, `Events:${evt.Id}`, citationsByFact, sourceIdToXref, partCitations('DATE'));
            }
            if (evt.Place) {
                pushGedcomLine(lines, 2, 'PLAC', evt.Place);
                pushPlaceForm(lines, 3, placeLookupKey(evt.Place, evt.PlaceId), placeForms);
                pushPlaceMap(lines, 3, placeLookupKey(evt.Place, evt.PlaceId), coords);
                pushPlaceNotes(lines, 3, placeLookupKey(evt.Place, evt.PlaceId), placeNoteIds, xrefForNote);
                pushCitations(lines, 3, `Events:${evt.Id}`, citationsByFact, sourceIdToXref, partCitations('PLAC'));
            }
            pushCitations(lines, 2, `Events:${evt.Id}`, citationsByFact, sourceIdToXref, factCitations(evt.Date, evt.Place));
            // Event-level notes nest under the event (2 NOTE @N@) — GEDCOM 5.5.1
            // EVENT_DETAIL <<NOTE_STRUCTURE>> (4.1).
            for (const noteId of noteIdsByOwner.get(`Events:${evt.Id}`) ?? []) lines.push(`2 NOTE ${xrefForNote(noteId)}`);
            // Event-level media nests under the event (2 OBJE) — GEDCOM 5.5.1
            // EVENT_DETAIL <<MULTIMEDIA_LINK>>.
            pushMediaPointers(lines, mediaByOwner.get(`Events:${evt.Id}`) ?? [], mediaXrefById, 2);
            // Passthrough: re-emit verbatim event sub-tags the importer did not model (#423).
            pushRaw(lines, evt.RawGedcom);
        }
    }

    pushMediaPointers(lines, mediaByOwner.get(`People:${p.Id}`) ?? [], mediaXrefById);

    // Name variants — NICK / _AKA now live in the NameVariant table (the importer
    // promotes them there so the app can actually read a nickname). Maiden, married
    // and anglicized names go out as a later `1 NAME` + `2 TYPE`, which other apps
    // read and the importer maps back (#872). `Given` has no GEDCOM home and rides
    // only in the sources.json sidecar.
    const emittedNameTags = new Set<string>();
    for (const nv of nameVariantsByPerson?.get(p.Id) ?? []) {
        if (nicknamesUnderName.has(nv.Id)) { emittedNameTags.add(`${nv.Type}:${nv.Name}`); continue; }
        if (nv.Type === 'Nickname') pushGedcomLine(lines, 1, 'NICK', nv.Name);
        else if (nv.Type === 'Alias') pushGedcomLine(lines, 1, '_AKA', nv.Name);
        else if (VARIANT_TO_NAME_TYPE[nv.Type]) {
            pushGedcomLine(lines, 1, 'NAME', nv.Name);
            lines.push(`2 TYPE ${VARIANT_TO_NAME_TYPE[nv.Type]}`);
        }
        else continue;
        // The variant's own citations, so a .ged without sources.json keeps them (#963).
        pushCitations(lines, 2, `NameVariant:${nv.Id}`, citationsByFact, sourceIdToXref);
        emittedNameTags.add(`${nv.Type}:${nv.Name}`);
    }
    // Legacy "NICK: Bill" text recovered from a backfilled note (#524 / ADR 0010).
    // Deduped against the real NameVariant rows above: a person re-imported since
    // the promotion landed has both, and emitting each would double the tag.
    for (const tag of legacyNameTags?.get(p.Id) ?? []) {
        if (emittedNameTags.has(`${tag.type}:${tag.name}`)) continue;
        emittedNameTags.add(`${tag.type}:${tag.name}`);
        lines.push(tag.type === 'Nickname' ? `1 NICK ${tag.name}` : `1 _AKA ${tag.name}`);
    }

    // Notes. First-class People notes are the source of truth (ADR 0010 / #407) and
    // emit as shared `1 NOTE @Nn@` pointers, exactly like Families/Sources/Events.
    const personNoteIds = noteIdsByOwner.get(`People:${p.Id}`) ?? [];
    for (const noteId of personNoteIds) lines.push(`1 NOTE ${xrefForNote(noteId)}`);

    // The legacy People."Notes" column is GONE as of #524 / ADR 0010, so both
    // things that used to hang off it here are retired:
    //
    // 1. The NICK:/_AKA: prefix extraction moved to the caller, where it reads the
    //    backfilled Note row instead — see `legacyNameTags` in generateGedcom.
    // 2. The inline note-body fallback is no longer needed. It existed to cover the
    //    window between a column write and the init-schema backfill mirroring it
    //    into a Note row; with no column to write, there is no such window and
    //    first-class notes are the only source.

    // Family as child (FAMC), with its pedigree linkage. `PEDI` belongs here rather
    // than on the FAM record — CHILD_TO_FAMILY_LINK, ged551-2.txt:351-357. 'Birth'
    // is the column default and carries no information, so it is omitted; a missing
    // PEDI re-imports as Birth anyway (ADR 0012). The link's passthrough follows: a
    // PEDI this app can't map (step, sealing) and unmodeled sub-lines (#954).
    if (p.familiesAsChild) {
        for (const fam of p.familiesAsChild) {
            const famId = familyIdMap.get(fam.Id);
            if (famId) {
                lines.push(`1 FAMC ${famId}`);
                const link = childLinkByLink?.get(`${fam.Id}:${p.Id}`);
                if (link?.pedi) lines.push(`2 PEDI ${link.pedi}`);
                pushRaw(lines, link?.famcRawGedcom);
            }
        }
    }

    // Family as spouse (FAMS)
    if (p.familiesAsSpouse) {
        for (const fam of p.familiesAsSpouse) {
            const famId = familyIdMap.get(fam.Id);
            if (famId) {
                lines.push(`1 FAMS ${famId}`);
            }
        }
    }

    // Whole-person citations at INDI level
    pushCitations(lines, 1, `People:${p.Id}`, citationsByFact, sourceIdToXref);

    // Passthrough: re-emit verbatim subtrees the importer preserved but did not model.
    pushRaw(lines, p.RawGedcom);
}

/** Whether any of these links names a record this file emits, so a pointer will be written. */
function hasMediaPointers(links: GedcomExportMediaLink[] | undefined, mediaXrefById: Map<number, string>): boolean {
    return (links ?? []).some((link) => mediaXrefById.has(link.MediaId));
}

/** Emit owner pointers to one shared top-level multimedia record. */
function pushMediaPointers(
    lines: string[],
    links: GedcomExportMediaLink[],
    mediaXrefById: Map<number, string>,
    level: number = 1,
): void {
    for (const link of links) {
        const xref = mediaXrefById.get(link.MediaId);
        if (xref) lines.push(`${level} OBJE ${xref}`);
    }
}

/** Emit one canonical top-level multimedia record and its People primaries. */
function pushTopLevelMediaRecord(
    lines: string[],
    media: GedcomExportMedia,
    xref: string,
    /** Owner xrefs this photo is the portrait (`@I…@`) or family photo (`@F…@`) of. */
    primaryPeople: string[],
): void {
    lines.push(`0 ${xref} OBJE`);
    // A kept FORM with sub-lines of its own (`3 TYPE`) replaces the plain one (#976).
    const rawForm = /^1 FORM\b/m.test(media.FileRawGedcom ?? '');
    let fileWritten = true;
    if (media.FilePath) {
        pushGedcomLine(lines, 1, 'FILE', archiveMediaPath(xref, { Title: media.Title, FilePath: media.FilePath }));
        if (media.Format && !rawForm) pushGedcomLine(lines, 2, 'FORM', media.Format);
    } else if (media.SourceFile) {
        // A reference whose bytes never arrived keeps the FILE text it came with.
        // A line break (a CONT under FILE) goes back out as CONT, never raw.
        pushGedcomText(lines, 1, 'FILE', media.SourceFile);
        if (media.Format && !rawForm) pushGedcomLine(lines, 2, 'FORM', media.Format);
    } else {
        fileWritten = false;
    }
    if (media.Title) pushGedcomLine(lines, 2, 'TITL', media.Title);
    if (fileWritten) pushRaw(lines, media.FileRawGedcom, 1);
    for (const personXref of primaryPeople) lines.push(`1 _PRIM ${personXref}`);
    if (media.FocalX != null && media.FocalX !== 50) lines.push(`1 _FOCALX ${media.FocalX}`);
    if (media.FocalY != null && media.FocalY !== 50) lines.push(`1 _FOCALY ${media.FocalY}`);
    if (media.FocalRadius != null && media.FocalRadius > 0) lines.push(`1 _FOCALR ${media.FocalRadius}`);
}

/**
 * Re-emit verbatim GEDCOM subtrees stored on a record by the passthrough (Slice 0p).
 * `base` shifts lines stored relative to their owner to the owner's level (#976).
 */
function pushRaw(lines: string[], raw: string | null | undefined, base = 0): void {
    if (!raw) return;
    // A media pointer kept before #979 can't be trusted, so it's marked to be dropped and counted.
    for (const l of markStaleMediaPointers(raw.split('\n'))) {
        // A stored line always starts with a short level; anything else isn't written.
        if (!/^\d{1,2} \S/.test(l)) continue;
        const line = l.trimEnd();
        lines.push(base ? line.replace(/^\d+/, (n) => String(Number(n) + base)) : line);
    }
}

/**
 * Generates a GEDCOM family (FAM) record
 */
function generateFamilyRecord(
    lines: string[],
    f: FamilyWithRelations,
    personIdMap: Map<number, string>,
    familyIdMap: Map<number, string>,
    coords: Map<string, { lat: number; lng: number }> | undefined,
    citationsByFact: Map<string, GedcomExportCitation[]>,
    sourceIdToXref: Map<number, string>,
    noteIdsByOwner: Map<string, number[]>,
    noteIdsByFact: Map<string, number[]>,
    xrefForNote: (id: number) => string,
    mediaByOwner: Map<string, GedcomExportMediaLink[]>,
    mediaXrefById: Map<number, string>,
    placeForms?: Map<string, string>,
    placeNoteIds?: Map<string, number[]>,
): void {
    const gedcomId = familyIdMap.get(f.Id)!;
    lines.push(`0 ${gedcomId} FAM`);

    const p1Id = f.Partner1Id;
    const p2Id = f.Partner2Id;
    if (p1Id) {
        const husbId = personIdMap.get(p1Id);
        if (husbId) {
            lines.push(`1 HUSB ${husbId}`);
            pushRaw(lines, f.Partner1RawGedcom);
        }
    }

    if (p2Id) {
        const wifeId = personIdMap.get(p2Id);
        if (wifeId) {
            lines.push(`1 WIFE ${wifeId}`);
            pushRaw(lines, f.Partner2RawGedcom);
        }
    }

    // Children. A relationship both partners share rides on the standard `2 PEDI`
    // under the CHILD's own `1 FAMC` (see generatePersonRecord, ADR 0012); one per
    // partner is FTM's `2 _FREL` / `2 _MREL` here (#982). An imported link's other
    // CHIL sub-lines ride back verbatim (#961).
    if (f.children) {
        const present = exportedPartners(f, personIdMap);
        for (const child of f.children) {
            const childId = personIdMap.get(child.Id);
            if (childId) {
                lines.push(`1 CHIL ${childId}`);
                lines.push(...childLinkRelationshipLines(child, present).chil);
                pushRaw(lines, child.ChilRawGedcom);
            }
        }
    }

    const hasMarriageFactContent = (noteIdsByFact.get(`Families:${f.Id}:Marriage`)?.length ?? 0) > 0
        || hasMediaPointers(mediaByOwner.get(`Families:${f.Id}:Marriage`), mediaXrefById)
        || Boolean(f.MarriageRawGedcom)
        || citationsByFact.has(`FamilyMarriage:${f.Id}`);
    const hasMarriageContent = Boolean(f.MarriageDate || f.MarriagePlace) || hasMarriageFactContent;
    // Married, with nothing more known: 5.5.1 spells that `1 MARR Y` (#965).
    if (!hasMarriageContent && f.MarriageRecorded) lines.push('1 MARR Y');
    if (hasMarriageContent) {
        lines.push('1 MARR');
        if (f.MarriageDate) {
            lines.push(`2 DATE ${formatDateForGedcom(f.MarriageDate)}`);
            pushCitations(lines, 3, `FamilyMarriage:${f.Id}`, citationsByFact, sourceIdToXref, partCitations('DATE'));
        }
        if (f.MarriagePlace) {
            pushGedcomLine(lines, 2, 'PLAC', f.MarriagePlace);
            pushPlaceForm(lines, 3, placeLookupKey(f.MarriagePlace, f.MarriagePlaceId), placeForms);
            pushPlaceMap(lines, 3, placeLookupKey(f.MarriagePlace, f.MarriagePlaceId), coords);
            pushPlaceNotes(lines, 3, placeLookupKey(f.MarriagePlace, f.MarriagePlaceId), placeNoteIds, xrefForNote);
            pushCitations(lines, 3, `FamilyMarriage:${f.Id}`, citationsByFact, sourceIdToXref, partCitations('PLAC'));
        }
        // A marriage citation nests under `1 MARR`, apart from the family's own `1 SOUR` (#962).
        pushCitations(lines, 2, `FamilyMarriage:${f.Id}`, citationsByFact, sourceIdToXref, factCitations(f.MarriageDate, f.MarriagePlace));
        for (const noteId of noteIdsByFact.get(`Families:${f.Id}:Marriage`) ?? []) lines.push(`2 NOTE ${xrefForNote(noteId)}`);
        pushMediaPointers(lines, mediaByOwner.get(`Families:${f.Id}:Marriage`) ?? [], mediaXrefById, 2);
        // Passthrough: re-emit verbatim MARR sub-tags the importer did not model (#423).
        pushRaw(lines, f.MarriageRawGedcom);
    }

    // Family life-cycle events (divorce/annulment/engagement/…) stored as Events
    // rows. Standard GEDCOM family-event tags emit directly; anything else (e.g.
    // SEPA) rides on a generic `1 EVEN` + `2 TYPE`.
    const STD_FAMILY_TAGS = new Set(['DIV', 'ANUL', 'ENGA', 'MARB', 'MARC', 'MARL', 'MARS', 'DIVF', 'CENS', 'RESI', 'EVEN']);
    for (const evt of f.events ?? []) {
        // Marriage is the family anchor, owned by the MarriageDate/MarriagePlace
        // columns and emitted above. A stray MARR Events row (possible from legacy
        // data) must not double-emit a second `1 MARR`.
        if (evt.Type === 'MARR') continue;
        const std = STD_FAMILY_TAGS.has(evt.Type);
        lines.push(`1 ${std ? evt.Type : 'EVEN'}`);
        if (!std) pushGedcomLine(lines, 2, 'TYPE', evt.Type);
        if (evt.Date) {
            lines.push(`2 DATE ${formatDateForGedcom(evt.Date)}`);
            pushCitations(lines, 3, `Events:${evt.Id}`, citationsByFact, sourceIdToXref, partCitations('DATE'));
        }
        if (evt.Place) {
            pushGedcomLine(lines, 2, 'PLAC', evt.Place);
            pushPlaceForm(lines, 3, placeLookupKey(evt.Place, evt.PlaceId), placeForms);
            pushPlaceMap(lines, 3, placeLookupKey(evt.Place, evt.PlaceId), coords);
            pushPlaceNotes(lines, 3, placeLookupKey(evt.Place, evt.PlaceId), placeNoteIds, xrefForNote);
            pushCitations(lines, 3, `Events:${evt.Id}`, citationsByFact, sourceIdToXref, partCitations('PLAC'));
        }
        // Event-scoped source citations nest under the family event (2 SOUR @Sn@) —
        // GEDCOM 5.5.1 EVENT_DETAIL <<SOURCE_CITATION>> (§4.3). Mirrors the person-event
        // path; without this, family-event citations imported to Events rows never export.
        pushCitations(lines, 2, `Events:${evt.Id}`, citationsByFact, sourceIdToXref, factCitations(evt.Date, evt.Place));
        if (evt.Description) pushGedcomLine(lines, 2, 'NOTE', evt.Description);
        // Event-level shared notes nest under the family event (2 NOTE @N@) — distinct
        // from the Description echo above (4.1).
        for (const noteId of noteIdsByOwner.get(`Events:${evt.Id}`) ?? []) lines.push(`2 NOTE ${xrefForNote(noteId)}`);
        // Event-level media nests under the family event (2 OBJE).
        pushMediaPointers(lines, mediaByOwner.get(`Events:${evt.Id}`) ?? [], mediaXrefById, 2);
        // Passthrough: re-emit verbatim event sub-tags the importer did not model (#423).
        pushRaw(lines, evt.RawGedcom);
    }

    // Family ending is now an Events row (divorce/annulment/separation/…), emitted by
    // the family-events loop above — the legacy EndedDate/EndedReason columns and their
    // DIV/_ENDED/_ENDREASON round-trip were retired in Phase 2.

    // Family type — a custom tag with no GEDCOM equivalent. 'Marriage' is the default
    // Type, so it is omitted.
    if (f.Type && f.Type !== 'Marriage') {
        lines.push(`1 _FTYPE ${f.Type}`);
    }

    // Whole-family citations at FAM level
    pushCitations(lines, 1, `Families:${f.Id}`, citationsByFact, sourceIdToXref);

    // Shared-note pointers attached to this family (Slice 1).
    for (const noteId of noteIdsByOwner.get(`Families:${f.Id}`) ?? []) {
        lines.push(`1 NOTE ${xrefForNote(noteId)}`);
    }

    // Media attached to this family — pointer-only owner link.
    pushMediaPointers(lines, mediaByOwner.get(`Families:${f.Id}`) ?? [], mediaXrefById);

    // Passthrough: re-emit verbatim subtrees the importer preserved but did not model.
    pushRaw(lines, f.RawGedcom);
}

// formatDate is now imported from @/lib/date-utils as formatDateForGedcom
