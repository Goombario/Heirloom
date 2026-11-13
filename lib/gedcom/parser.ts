import type { GedcomEvent, NewPerson, NewFamily } from '../db/schema';
import { parseGedcomLat, parseGedcomLng } from './coords';
import { foldToldBy } from '../utils/told-by';
import { normalizeNameOrNull, normalizeNameText } from '../validation';
import { FTM_VALUE_TO_CHILD_RELATIONSHIP, type ChildRelationshipType, type ChildRelationships } from '../child-relationship';

type ParsedEvent = GedcomEvent & {
    citations: ParsedFactCitation[];
    media: ParsedMedia[];
    mediaRefs: ParsedMediaRef[];
    notes: ParsedNoteRef[];
    rawLines: string[];
};

/**
 * A NOTE attached to a record — either inline text or a pointer to a standalone
 * `0 @N@ NOTE` record (resolved to text after the whole file is parsed). Slice 1
 * promotes family/source notes from passthrough to this real, attachable model.
 */
export interface ParsedNoteRef {
    /** Inline text, or the resolved text of a referenced NOTE record. */
    text: string | null;
    /** The `@N@` xref this note came from (null for inline notes). */
    xref: string | null;
    /** Promoted fact this note belongs to, when it is nested under BIRT/DEAT/MARR. */
    ownerFact?: 'Birth' | 'Death' | 'Marriage';
}

/**
 * A note attached to a place (GEDCOM `PLACE_STRUCTURE`'s `+1 <<NOTE_STRUCTURE>>`,
 * ged551-2.txt:659-674) — same shape as ParsedNoteRef plus which place string it
 * was nested under. Captured generically regardless of whether the PLAC belonged
 * to a BIRT/DEAT/MARR or a generic event (none of those record types have their
 * own per-occurrence notes array for a flat place field).
 */
export interface ParsedPlaceNote extends ParsedNoteRef {
    name: string;
}

/**
 * A multimedia object attached to an owner — either inline (`OBJE` with
 * FILE/FORM/TITL/_PRIM/focal sub-lines) or a pointer represented separately by
 * ParsedMediaRef. Standalone `0 @O@ OBJE` records are retained in mediaRecords;
 * owners never receive a copied record.
 */
export interface ParsedMedia {
    Title: string | null;
    FilePath: string | null;
    Format: string | null;
    /** Legacy owner-local primary state (`_PRIM Y|N`) for inline media. */
    legacyPrimary: number | null;
    FocalX?: number | null;
    FocalY?: number | null;
    FocalRadius?: number | null;
    /** `@O@` xref this came from (null for inline media). */
    xref: string | null;
    /** `FILE` sub-lines the app doesn't model (FTM's `_DATE` / `_TEXT`, …), levels relative to FILE (#976). */
    fileRawLines?: string[];
    /** Set when the OBJE sits under the owner's BIRT, DEAT or MARR (#905, ADR 0030). */
    ownerFact?: 'Birth' | 'Death' | 'Marriage';
}

/** A standalone `0 @O@ OBJE` record retained once per xref. */
export interface ParsedMediaRecord extends ParsedMedia {
    xref: string;
    /** Canonical top-level primary owners emitted as `_PRIM @I...@`, and family photos as `_PRIM @F...@` (#119). */
    primaryPersonXrefs: string[];
}

/** A pointer occurrence retained on its owner; the pointed record is not copied. */
export interface ParsedMediaRef {
    xref: string;
    legacyPrimary: number | null;
    /** Set when the pointer sits under the owner's BIRT, DEAT or MARR (#905, ADR 0030). */
    ownerFact?: 'Birth' | 'Death' | 'Marriage';
}

export interface ParsedPerson extends Omit<NewPerson, 'Id' | 'UserId'> {
    gedcomId: string;
    events: ParsedEvent[];
    media: ParsedMedia[];
    mediaRefs: ParsedMediaRef[];
    famcRefs: string[]; // Family as child references
    /**
     * famcRef → raw `PEDI` value from that `1 FAMC`'s subordinate pedigree-linkage
     * line. Resolved into the FAMILY's `chilRelationships` after the whole file is parsed:
     * GEDCOM records pedigree on the child's INDI, but the importer builds
     * `FamilyPerson` rows from the FAM side, so it has to cross over (ADR 0012).
     */
    famcPedi: Record<string, string>;
    /**
     * famcRef → verbatim sub-lines of that `1 FAMC` the parser doesn't model
     * (`2 _PEDI`, `2 NOTE`, …), captured through the #423 `subRawTarget` path.
     * Crossed over to the family's `chilFamcRaw` with `famcPedi` (#954).
     */
    famcRawLines: Record<string, string[]>;
    famsRefs: string[]; // Family as spouse references
    citations: ParsedPersonCitation[];
    /**
     * First-class notes (ADR 0010), same shape as families/sources. Replaces the
     * fold into the scalar `Notes` column, which forked shared notes in two.
     */
    notes: ParsedNoteRef[];
    /**
     * Name variants promoted from NICK / _AKA and from every `1 NAME` after the
     * first, persisted as `NameVariant` rows. These used to be appended to `Notes`
     * as "NICK: Bill" text, which round-tripped but left every imported nickname
     * unreadable by the app — the display path keys off `NameVariant`, not note text.
     * A later NAME used to overwrite the primary name instead (#872).
     */
    nameVariants: ParsedNameVariant[];
    /** Verbatim level-1 subtrees this parser does not model, for lossless round-trip (passthrough). */
    rawLines: string[];
    /**
     * Verbatim sub-tags of `1 BIRT` / `1 DEAT` this parser does not model (CAUS, AGE,
     * AGNC, RESN, …), kept separate from `rawLines` because BIRT/DEAT are People
     * *columns* (BirthDate/DeathDate), not an Events row — the record-level `rawLines`
     * blob is emitted once at the end of the record, which would wrongly detach these
     * from the `1 BIRT`/`1 DEAT` line they belong under (#423).
     */
    birthRawLines: string[];
    deathRawLines: string[];
    /** Sub-lines of the primary `1 NAME` the parser doesn't model (NPFX, NSFX, SPFX, TYPE, …) (#964). */
    nameRawLines: string[];
}

export interface ParsedFamily extends Omit<NewFamily, 'Id' | 'UserId'> {
    gedcomId: string;
    /** Partner1: the first `HUSB`, or any partner pointer when that slot is free (#873). */
    husbRef?: string;
    /** Partner2: the first `WIFE`, or any partner pointer when that slot is free (#873). */
    wifeRef?: string;
    /** Partner pointers beyond two, kept raw in `rawLines` and reported as a warning. */
    extraPartnerRefs: string[];
    /**
     * partner pointer → verbatim sub-lines of its `1 HUSB` / `1 WIFE` (Legacy's
     * `2 _PREF Y`), persisted as `Families."Partner1RawGedcom"` / `"Partner2RawGedcom"`
     * and re-emitted under that partner's line (#989). An extra partner's lines
     * ride `rawLines` under its own raw `1 HUSB` / `1 WIFE` instead.
     */
    partnerRawLines: Record<string, string[]>;
    chilRefs: string[];
    /**
     * chilRef → the child's relationship to each partner (#982), set when the file
     * states one. Populated after the parse: a standard `PEDI` under the child's own
     * `INDI.FAMC` sets both partners (ADR 0012), and FTM's `2 _FREL` / `2 _MREL`
     * under the family's `1 CHIL` set Partner1 / Partner2 over it. Absent is Birth.
     */
    chilRelationships: Record<string, ChildRelationships>;
    /**
     * chilRef → the child's `INDI.FAMC` passthrough for this family, persisted as
     * `FamilyPerson."FamcRawGedcom"` and re-emitted under that `1 FAMC` (#954).
     * Holds the unmodeled sub-lines plus a `2 PEDI` this app can't map (step,
     * sealing, vendor values), spelled as the file spelled it.
     */
    chilFamcRaw: Record<string, string>;
    /**
     * chilRef → verbatim sub-lines of that `1 CHIL` (FTM's `2 _FREL` / `2 _MREL`,
     * `2 _PREF`, …), persisted as `FamilyPerson."ChilRawGedcom"` and re-emitted
     * under it (#961). A `_FREL`/`_MREL` with a type sets a partner's relationship
     * and leaves these lines; one without (Related, Sealed, Private) stays.
     */
    chilRawLines: Record<string, string[]>;
    /** Family life-cycle events (divorce/annulment/engagement/separation/…) as Events rows. */
    events: ParsedEvent[];
    citations: ParsedFamilyCitation[];
    notes: ParsedNoteRef[];
    media: ParsedMedia[];
    mediaRefs: ParsedMediaRef[];
    rawLines: string[];
    /** Verbatim sub-tags of `1 MARR` this parser does not model — same reasoning as
     *  ParsedPerson.birthRawLines/deathRawLines (#423). */
    marriageRawLines: string[];
}

export interface ParsedSource {
    xref: string;
    Title: string | null;
    Author: string | null;
    PublicationInfo: string | null;
    Text: string | null;       // from _URL
    Contents: string | null;   // from TEXT
    Type: string | null;       // from _TYPE
    /** `_TOLDBY` from an export made before #470; folded into Author when parsing ends. */
    legacyToldBy: string | null;
    Num: number | null;        // from _NUM
    Abbreviation: string | null;      // from ABBR — short filing title (#501)
    RepositoryName: string | null;
    repoXref: string | null;
    CallNumber: string | null;
    Medi: string | null;              // CALN.MEDI — medium of the call number (Slice 4)
    RepositoryAddress: string | null; // REPO.ADDR — resolved from the REPO record (Slice 4)
    notes: ParsedNoteRef[];
    media: ParsedMedia[];
    mediaRefs: ParsedMediaRef[];
    rawLines: string[];
}

/**
 * Level-1 tags each record type's parser already extracts into a field. Any OTHER level-1
 * tag (and its subordinate lines) is captured verbatim into the record's `rawLines` so it
 * survives an import → export → re-import round-trip instead of being silently dropped.
 * This is the passthrough safety net; later slices "promote" specific tags into real fields.
 */
const HANDLED_INDI_L1 = new Set([
    'NAME', 'SEX', 'BIRT', 'DEAT', 'FAMC', 'FAMS', 'OBJE', 'NOTE', 'NICK', '_AKA', 'SOUR', '_LIVING',
    // event tags mapped to the Events table
    'OCCU', 'EDUC', 'RESI', 'BURI', 'CHR', 'BAPM', 'ADOP', 'EVEN', 'GRAD', 'EMIG', 'IMMI', 'NATU',
    'CENS', 'RETI', 'PROB', 'WILL',
]);
const HANDLED_FAM_L1 = new Set([
    'HUSB', 'WIFE', 'CHIL', 'MARR', 'SOUR', 'NOTE', 'OBJE', '_FTYPE', '_ENDED', '_ENDREASON',
    // Family life-cycle event tags mapped to the Events table (Phase 2).
    'DIV', 'ANUL', 'ENGA', 'MARB', 'MARC', 'MARL', 'MARS', 'DIVF', 'CENS', 'RESI', 'EVEN',
]);

/**
 * Level-1 tags PROMOTED to columns rather than an Events row (#513).
 *
 * GEDCOM lets a record carry several of these — a civil and a religious marriage,
 * a baptismal and a recorded birth — but a column holds exactly one. A second
 * occurrence used to overwrite the first with no trace, which is silent loss.
 *
 * Repeats are therefore treated as UNMODELED: they fall through to the
 * record-level passthrough, which captures the whole block (opening line
 * included) verbatim and re-emits it at record end as a valid second block. The
 * first occurrence still owns the column, so nothing about the common case moves.
 */
const PROMOTED_INDI_L1 = new Set(['BIRT', 'DEAT']);
const PROMOTED_FAM_L1 = new Set(['MARR']);
// ABBR is `{0:M}` in the spec (ged551-2.txt:251) but Sources."Abbreviation" holds
// one, so repeats take the same passthrough route as a second BIRT (#501/#513).
const PROMOTED_SOUR_L1 = new Set(['ABBR']);
/**
 * GEDCOM 5.5.1 PEDIGREE_LINKAGE_TYPE (`[ adopted | birth | foster | sealing ]`,
 * ged551-3.txt:1000-1002) → `FamilyPerson."RelationshipType"`. `sealing` is an LDS
 * ordinance with no equivalent in this app and is deliberately absent, so it falls
 * back to the column default instead of inventing a value (ADR 0012). Keys are
 * lowercase; lookups lowercase the input, since real exporters vary the casing.
 */
const PEDI_TO_RELATIONSHIP_TYPE: Record<string, ChildRelationshipType> = {
    birth: 'Birth',
    adopted: 'Adoption',
    foster: 'Foster',
};

/** `1 CHIL` models nothing below it; every sub-line rides the link's passthrough (#961). */
const HANDLED_CHIL_L2 = new Set<string>();
/** Nor do `1 HUSB` / `1 WIFE`: every sub-line rides that partner's passthrough (#989). */
const HANDLED_PARTNER_L2 = new Set<string>();

const HANDLED_SOUR_L1 = new Set([
    'TITL', 'AUTH', 'PUBL', 'TEXT', '_URL', '_TYPE', '_TOLDBY', '_NUM', 'REPO', 'CALN', 'NOTE', 'OBJE',
    // ABBR is modeled as of #501. It MUST be here in the same change that adds the
    // column, or it would keep riding Sources."RawGedcom" passthrough and emit twice.
    'ABBR',
]);

/**
 * Level-2 sub-tags already modeled for an open BIRT/DEAT/MARR column scope, or an
 * Events-backed custom event (#423). Anything else directly under one of these
 * scopes (and everything nested under it) is swept into that scope's own
 * `rawLines` instead of being silently dropped — the record-level capture above
 * never reaches it, because BIRT/DEAT/MARR/the event's own opening tag are
 * themselves handled level-1 tags, and passthrough only ever engages when the
 * level-1 tag itself is unrecognized.
 */
const HANDLED_COLUMN_EVENT_L2 = new Set(['DATE', 'PLAC', 'NOTE', 'SOUR', 'CAUS', 'OBJE']);
/** `1 FAMC` models only `PEDI`; an unmapped value is put back raw after the parse (#954). */
const HANDLED_FAMC_L2 = new Set(['PEDI']);
/**
 * The primary `1 NAME` models GIVN/SURN (export re-derives them from the name
 * columns), NICK (a NameVariant), SOUR (a PersonName citation) and NOTE (a person
 * note); the rest (NPFX, NSFX, SPFX, TYPE, FONE, …) rides its passthrough (#964).
 */
const HANDLED_NAME_L2 = new Set(['GIVN', 'SURN', 'NICK', 'SOUR', 'NOTE']);
const HANDLED_PERSON_EVENT_L2 = new Set(['DATE', 'PLAC', 'NOTE', 'SOUR', 'OBJE']);
/** A fact's PLAC sub-lines the import keeps (the continuations ride the PLAC value). */
const PLACE_SUB_TAGS = new Set(['FORM', 'MAP', 'NOTE', 'SOUR', 'CONC', 'CONT']);
const HANDLED_FAMILY_EVENT_L2 = new Set(['DATE', 'PLAC', 'NOTE', 'SOUR', 'OBJE']);
/**
 * The generic `EVEN` variants, where `TYPE` is MODELED (it names the event, ADR
 * 0012) and so must not also be raw-captured — otherwise the label is stored both
 * on Events."Type" and in the event's rawLines, and export emits it twice.
 *
 * Only `EVEN` gets these. `TYPE` is not an EVEN-specific tag: it is the first
 * member of EVENT_DETAIL (`ged551-2.txt:359-361`), legal under every event —
 * "The TYPE tag can be used with each of the above tags used in this structure"
 * (`:448-449`). Under a standard tag it is an unmodeled qualifier ("2 TYPE
 * Cremation" under "1 BURI"), so it stays passthrough; treating it as the event's
 * name there would silently turn a burial into an event of type "Cremation".
 */
const HANDLED_PERSON_EVEN_L2 = new Set([...HANDLED_PERSON_EVENT_L2, 'TYPE']);
const HANDLED_FAMILY_EVEN_L2 = new Set([...HANDLED_FAMILY_EVENT_L2, 'TYPE']);

// OCCU and EDUC have legal value slots on the level-1 line, so their inline
// NOTE structures are always first-class event notes.  For the other
// Events-backed person events, this app emits legacy Events.Description as an
// inline NOTE to stay within GEDCOM 5.5.1.  Decode that form back into the
// Description column; NOTE pointers remain first-class linked notes so an
// exported description and existing linked notes can coexist without merging.
const PERSON_EVENT_INLINE_DESCRIPTION_TYPES = new Set([
    'RESI', 'BURI', 'CHR', 'BAPM', 'ADOP', 'EVEN', 'GRAD', 'EMIG', 'IMMI', 'NATU',
    'CENS', 'RETI', 'PROB', 'WILL',
]);

/** OBJE sub-tags routed to the current media object (shared by family/source media). */
const MEDIA_SUBTAGS = new Set(['FILE', 'FORM', 'TITL', '_PRIM', '_FOCALX', '_FOCALY', '_FOCALR']);

export type CitationPart = 'DATE' | 'PLAC';

export interface ParsedFactCitation {
    sourceXref: string;
    page: string | null;
    note: string | null;
    // Slice 3 — SOURCE_CITATION evidence sub-fields.
    quay: string | null;
    dataText: string | null;
    dataDate: string | null;
    even: string | null;
    role: string | null;
    /** Sub-lines the app doesn't model (an `OBJE`), levels relative to the citation's SOUR (#976). */
    rawLines?: string[];
    /** The part of the fact it cites: a `3 SOUR` under the fact's `2 DATE` or `2 PLAC` (#990). */
    part?: CitationPart;
}

/** A `0 @R@ REPO` record (#966). */
export interface ParsedRepository {
    /** The file's `@Rn@`, so a kept pointer to it can resolve to the repository (#985). */
    xref: string;
    name: string;
    address: string | null;
    /** Level-1 lines the app doesn't model (PHON, EMAIL, WWW, CHAN, …) with their sub-lines. */
    rawLines: string[];
    /** ADDR's structured sub-lines (ADR1, CITY, POST, CTRY, …), re-emitted under `1 ADDR`. */
    addrRawLines: string[];
}

/** A `NameVariant` row from NICK / _AKA or a non-first `1 NAME` (#872). */
interface ParsedNameVariant {
    Type: 'Nickname' | 'Alias' | 'Maiden' | 'Married' | 'Anglicized';
    Name: string;
    /** `2 SOUR` under a non-first NAME; persisted with FactTable 'NameVariant'. */
    citations?: ParsedFactCitation[];
}

/**
 * GEDCOM NAME_TYPE (5.5.1 `aka | birth | immigrant | maiden | married`, GEDCOM 7
 * adds `PROFESSIONAL` / `OTHER`) → the app's NameVariant vocabulary. Keys are
 * lowercase; anything unmapped becomes an Alias.
 */
const NAME_TYPE_TO_VARIANT: Record<string, ParsedNameVariant['Type']> = {
    aka: 'Alias',
    birth: 'Maiden',
    maiden: 'Maiden',
    married: 'Married',
    immigrant: 'Anglicized',
};

/** `Anna /Jones/` → `Anna Jones`: a variant stores one display string. */
function nameVariantText(value: string): string {
    return value.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
}

/** A family citation: the whole family (`1 SOUR`) or its marriage (`1 MARR` / `2 SOUR`, #962). */
interface ParsedFamilyCitation extends ParsedFactCitation {
    factTable?: 'FamilyMarriage';
}

export interface ParsedPersonCitation extends ParsedFactCitation {
    factTable: 'People' | 'PersonName' | 'PersonBirth' | 'PersonDeath';
}

/**
 * Parses a GEDCOM 5.5.1 file and returns people, families, and
 * place coordinates extracted from PLAC.MAP sub-structures.
 * Legacy _STORY records are silently ignored (stories feature is retired).
 */
export function parseGedcom(content: string): {
    people: ParsedPerson[];
    families: ParsedFamily[];
    placeCoords: { name: string; lat: number; lng: number }[];
    places: { name: string; form: string | null }[];
    placeNotes: ParsedPlaceNote[];
    mediaRecords: ParsedMediaRecord[];
    sources: ParsedSource[];
    /**
     * `REPOSITORY_RECORD` notes, keyed by repository NAME rather than `@Rn@` — the
     * importer creates repositories by name, and an xref means nothing outside the
     * file it came from (ADR 0012).
     */
    repositoryNotes: Array<{ name: string; notes: ParsedNoteRef[] }>;
    /**
     * Every named REPO record, cited or not, so it round-trips (#966): its address
     * and the lines the app doesn't model, kept to re-emit verbatim.
     */
    repositories: ParsedRepository[];
    /** Pointers whose target record isn't in the file, by kind; they import as nothing (#880). */
    danglingPointers: DanglingPointerCounts;
    /** Level-0 records whose xref an earlier record already used (#880). */
    duplicateXrefs: number;
    /** Child links whose pedigree value has no RelationshipType; kept raw (#954). */
    unmappedChildRelationships: { count: number; values: string[] };
    /** Inline `SOUR <text>` citations (no source record), kept as passthrough text (#963). */
    inlineCitationsKept: number;
    /** `SOUR` citations on something with no citation home (a NOTE or OBJE record), not imported (#963). */
    citationsUnplaced: number;
    /** Vendor level-0 records (`_EVENT_DEFN`, `_EVDEF`, `_PLAC`, …) the app doesn't keep, by tag (#967). */
    customRecordsDropped: { count: number; tags: string[] };
    /** GEDCOM 5.5 `BLOB` images embedded in an OBJE record, which the app can't keep (#977). */
    mediaBlobsDropped: number;
    /** `0 @N@ NOTE` records nothing in the file points at, such as Gramps' tree description, not imported (#995). */
    notesUnattached: number;
    /** Lines under a fact's PLAC the app doesn't model (ArkivDigital's `_ADPL`), not imported, by tag (#992). */
    placeLinesDropped: { count: number; tags: string[] };
    /** Each level-0 record's `@xref@` → its tag (the first record wins), to resolve passthrough pointers (#979). */
    recordTypes: Map<string, string>;
} {
    const people: ParsedPerson[] = [];
    const families: ParsedFamily[] = [];
    /** Coordinates collected from PLAC.MAP sub-structures. */
    const placeCoords: { name: string; lat: number; lng: number }[] = [];
    /** Notes collected from PLAC.NOTE sub-structures (resolved + filtered at the end). */
    const placeNotes: ParsedPlaceNote[] = [];
    // Distinct place names → their PLAC.FORM (Slice 5). Header default fills nulls.
    const placeFormMap = new Map<string, string | null>();
    let headerPlaceForm: string | null = null;
    let inHeader = false;
    /** Inside a vendor's own level-0 record (#967), whose PLAC lines aren't places (#969). */
    let inCustomRecord = false;
    // Level of the header's own `1 PLAC` line (its HEAD.PLAC.FORM sub-line sets
    // headerPlaceForm), so a `2 FORM` under some OTHER header substructure — most
    // notably `1 GEDC / 2 FORM LINEAGE-LINKED`, the file's dialect declaration —
    // is never mistaken for the place-form default. `inHeader` alone can't tell
    // these apart: it's true for the whole header block, not just under PLAC.
    let headerPlacLevel: number | null = null;
    let lastPlaceName: string | null = null;
    const sources: ParsedSource[] = [];
    const repoNames = new Map<string, string>(); // @Rn@ -> NAME
    // Standalone NOTE records (`0 @N@ NOTE`), keyed by xref. Their text is filled
    // by inline value + CONC/CONT, then resolved into each referencing record once
    // the whole file is parsed (a record may point at a NOTE defined later).
    const noteRecords = new Map<string, { text: string }>();
    // Standalone OBJE records (`0 @O@ OBJE`), keyed by xref. Owner refs resolve
    // against this map after parsing without copying its record payload.
    const objeRecords = new Map<string, ParsedMediaRecord>();
    const recordXrefs = new Set<string>();
    // Every `@xref@` a line below level 0 points at, so a NOTE record nothing
    // points at can be counted: it has no owner to import onto (#995).
    const pointedAt = new Set<string>();
    let duplicateXrefs = 0;
    let inlineCitationsKept = 0;
    let citationsUnplaced = 0;
    const customRecordTags = new Map<string, number>();
    const placeLineTags = new Map<string, number>();
    let mediaBlobsDropped = 0;
    const recordTypes = new Map<string, string>();
    const danglingPointers: DanglingPointerCounts = { source: 0, note: 0, media: 0, family: 0, person: 0 };
    // @Rn@ -> its ADDR (Slice 4) and the lines the app doesn't model (#966).
    const repoRecords = new Map<string, { address: string | null; rawLines: string[]; addrRawLines: string[] }>();
    /** Where the open REPO line goes: its passthrough, the ADDR value, or ADDR's own sub-lines. */
    let repoCapture: 'raw' | 'addr' | 'addrSub' | null = null;
    // @Rn@ -> its NOTE_STRUCTUREs, keyed by name once the record's NAME is known.
    const repoNotes = new Map<string, ParsedNoteRef[]>();
    let currentSource: ParsedSource | null = null;
    let currentRepoXref: string | null = null;
    // Normalize all three line-ending styles. Splitting on /\r?\n/ alone never breaks
    // on a lone CR, so classic-Mac (CR-only) files collapsed into a single line and
    // imported as an empty tree (audit 06 / GED-1). Split on CRLF, CR, or LF.
    const lines = content.split(/\r\n|\r|\n/).filter(line => line.trim());

    let currentPerson: ParsedPerson | null = null;
    let currentFamily: ParsedFamily | null = null;
    let currentTag = '';
    let currentEvent: ParsedEvent | null = null;
    // Placeholder end-event seeded by a legacy `_ENDED` line, resolved by `_ENDREASON`.
    let legacyEnd: ParsedEvent | null = null;
    let currentMedia: ParsedMedia | null = null;
    // Family/source OBJE in progress (person OBJE keeps using currentMedia above).
    // currentObjeMedia is the ParsedMedia being filled; currentObjeList is the
    // owner's media array (for _PRIM to clear sibling primaries); currentObjeRec is
    // a standalone `0 @O@ OBJE` record being filled. At most one is non-null.
    let currentObjeMedia: ParsedMedia | null = null;
    let currentObjeList: ParsedMedia[] | null = null;
    let currentObjeRec: ParsedMediaRecord | null = null;
    // Standalone OBJE metadata belongs to the first valid FILE subtree. Keep
    // later FILE subtrees from replacing its FORM/TITL pair, while accepting
    // legacy record-level FORM/TITL when no first-subtree value supplied it.
    let currentObjeFileSubtree = false;
    let currentObjeFileClosed = false;
    // Inside the record's first `1 FILE`, where an unmodelled `2` line is that FILE's (#976).
    let currentObjeInFile = false;
    // A subtree kept raw under a citation or a media FILE (#976): where its lines
    // go, the owner's level they're stored relative to, and the subtree's own
    // level. `header` is a modelled line (`2 FORM jpg`) kept only if it has children.
    let rawSubtree: { target: string[]; base: number; level: number; header: string | null } | null = null;
    let currentObjeRef: ParsedMediaRef | null = null;
    let currentObjeRefLevel = 0;
    let currentCitation: ParsedFactCitation | null = null;
    let currentCitationLevel = 0;
    // Which citation sub-container we're inside, so DATE/TEXT/ROLE bind correctly:
    // 'EVEN' → a ROLE belongs to the event; 'DATA' → DATE/TEXT are the data block.
    let currentCitationSub: 'EVEN' | 'DATA' | null = null;
    // The open `2 DATE` or `2 PLAC`, so a `3 SOUR` under it cites that part of the fact (#990).
    let openPart: CitationPart | null = null;
    // The open `1 FAMC` on the current person, so its `2 PEDI` binds to that link.
    let currentFamcRef: string | null = null;
    // Tracks the last string field written so CONC/CONT can append to it
    let lastValueRef: { obj: Record<string, unknown>; key: string } | null = null;
    // Tracks the most recently seen PLAC value for coordinate attachment
    let lastPlaceValue: string | null = null;
    // The PLAC line's own level, so a NOTE exactly one level deeper can be
    // attributed to it, and so we know when we've left its subtree (mirrors the
    // citation-close check further below for currentCitationLevel).
    let lastPlaceLevel: number | null = null;
    // Pending latitude from a LATI line (awaiting LONG to complete the pair)
    let pendingLat: number | null = null;
    // True while inside an unmodeled level-1 subtree being captured for passthrough.
    let rawCapturing = false;
    // Sub-event passthrough (#423): the rawLines array an open BIRT/DEAT/MARR column
    // scope or Events-backed custom event should capture unhandled children into, the
    // tag set that scope already models (so those aren't re-captured), and whether
    // we're currently inside an unhandled child's own subtree.
    let subRawTarget: string[] | null = null;
    let subRawHandled: Set<string> | null = null;
    /** Promoted level-1 tags already seen on the CURRENT record (#513). */
    const seenPromotedL1 = new Set<string>();
    // #872: GEDCOM's first NAME is the preferred one. Each later NAME opens a
    // NameVariant instead of overwriting it; `2 TYPE` / `2 SOUR` bind to that variant.
    let personNameSeen = false;
    let currentNameVariant: ParsedNameVariant | null = null;
    let subRawCapturing = false;

    for (const line of lines) {
        const trimmed = line.trim();
        // MyHeritage writes `0  _PUBLISH`, with two spaces after the level. Only the
        // level-tag gap is collapsed: a value keeps its own spacing (#993).
        const parts = trimmed.replace(/^(\S+) {2,}/, '$1 ').split(' ');
        if (parts.length < 2) continue;

        const level = parts[0];
        const tag = parts[1];
        // GEDCOM escapes a literal "@" as "@@"; collapse it back (GED-6). Real xref
        // pointers (@I1@) contain no "@@", so this leaves pointers untouched.
        const value = (parts.length > 2 ? parts.slice(2).join(' ') : '').replace(/@@/g, '@');
        const levelNum = parseInt(level, 10);
        if (levelNum > 0 && value.length > 2 && value.startsWith('@') && value.endsWith('@')) pointedAt.add(value);

        // CONC/CONT continue only the line right before them. Any other line ends
        // that value, so an unmodelled line's continuations (an event's `2 ADDR` /
        // `3 CONT`) can't land on a value set earlier, such as the event's PLAC (#969).
        if (tag !== 'CONC' && tag !== 'CONT') lastValueRef = null;
        if (levelNum <= 2) openPart = levelNum === 2 && (tag === 'DATE' || tag === 'PLAC') ? tag : null;

        // A PLAC's subordinate lines (MAP/LATI/LONG/FORM/NOTE) are always deeper
        // than the PLAC's own level; once a sibling-or-shallower line arrives, that
        // PLAC's scope has closed.
        if (lastPlaceLevel !== null && levelNum <= lastPlaceLevel) {
            lastPlaceValue = null;
            lastPlaceLevel = null;
        }

        // Leaving the header's `1 PLAC` sub-tree closes it the same way, so a FORM
        // under a LATER header substructure never gets attributed to it.
        if (headerPlacLevel !== null && levelNum <= headerPlacLevel) {
            headerPlacLevel = null;
        }

        // #966: a REPO record keeps what it doesn't model (PHON, EMAIL, WWW, CHAN,
        // REFN, …) as passthrough, and ADDR's structured lines (ADR1, CITY, POST, …)
        // apart, so they go back under ADDR. NAME, NOTE and the ADDR text (with its
        // CONT lines) are modeled below.
        if (currentRepoXref && levelNum >= 1) {
            const repo = repoRecords.get(currentRepoXref)!;
            if (levelNum === 1) {
                repoCapture = tag === 'ADDR' ? 'addr' : tag === 'NAME' || tag === 'NOTE' ? null : 'raw';
            } else if (levelNum === 2 && (repoCapture === 'addr' || repoCapture === 'addrSub')) {
                repoCapture = tag === 'CONT' || tag === 'CONC' ? 'addr' : 'addrSub';
            }
            if (repoCapture === 'raw') { repo.rawLines.push(trimmed); continue; }
            if (repoCapture === 'addrSub') { repo.addrRawLines.push(trimmed); continue; }
        }

        // A NOTE directly subordinate to the most recent PLAC is a place-level note
        // — captured here, before any person/family dispatch below, so it attaches
        // to the place instead of polluting whichever record's BIRT/DEAT/MARR/event
        // happened to hold that PLAC (none of those have a per-occurrence notes
        // array for a flat place field).
        if (tag === 'NOTE' && lastPlaceLevel !== null && levelNum === lastPlaceLevel + 1) {
            if (/^@.+@$/.test(value)) {
                placeNotes.push({ name: lastPlaceValue!, text: null, xref: value.trim() });
                continue;
            }
            const placeNote: ParsedPlaceNote = { name: lastPlaceValue!, text: value, xref: null };
            placeNotes.push(placeNote);
            lastValueRef = { obj: placeNote as unknown as Record<string, unknown>, key: 'text' };
            continue;
        }

        // ── Passthrough capture ────────────────────────────────────────────────────
        // Capture verbatim any level-1 subtree the parser does not model (and its
        // subordinate lines) onto the active record's `rawLines`, so it survives a
        // round-trip. Runs BEFORE the handlers below so a CONC/CONT inside a raw block
        // is captured rather than appended to an unrelated handled field.
        const rawRecord: { rawLines: string[] } | null =
            currentPerson ?? currentFamily ?? currentSource ?? null;
        if (rawRecord) {
            const lvl = parseInt(level, 10);
            if (lvl === 1) {
                const handled = currentPerson ? HANDLED_INDI_L1
                    : currentFamily ? HANDLED_FAM_L1 : HANDLED_SOUR_L1;
                // #513: the FIRST promoted tag owns its column; a repeat is demoted to
                // passthrough here rather than being allowed to overwrite it. Marking
                // it before the handlers run is what makes the whole block — opening
                // line and children alike — land in rawLines together.
                const promoted: Set<string> | null = currentPerson ? PROMOTED_INDI_L1
                    : currentFamily ? PROMOTED_FAM_L1
                    : currentSource ? PROMOTED_SOUR_L1 : null;
                let promotedRepeat = false;
                if (promoted?.has(tag)) {
                    promotedRepeat = seenPromotedL1.has(tag);
                    seenPromotedL1.add(tag);
                }
                // #963: an inline `1 SOUR <text>` (5.5.1's citation with no source
                // record) has no Citation home; it rides the record's passthrough.
                const inlineSour = tag === 'SOUR' && !value.startsWith('@') && !currentSource;
                if (inlineSour) inlineCitationsKept++;
                // #991: PAF's `DIV N` / `ANUL N` says the event did NOT happen. No event
                // is created; the line rides the family's passthrough so export keeps it.
                const notHappened = !!currentFamily && (tag === 'DIV' || tag === 'ANUL') && value === 'N';
                rawCapturing = !handled.has(tag) || promotedRepeat || inlineSour || notHappened;
                if (rawCapturing) { rawRecord.rawLines.push(trimmed); continue; }
            } else if (lvl >= 2 && rawCapturing) {
                rawRecord.rawLines.push(trimmed);
                continue;
            } else if (lvl <= 0) {
                rawCapturing = false;
            }
        } else {
            rawCapturing = false;
        }
        // ───────────────────────────────────────────────────────────────────────────

        // A raw subtree's lines, CONC/CONT included, are kept relative to its owner (#976).
        if (rawSubtree) {
            if (levelNum > rawSubtree.level) {
                // GEDCOM levels stay below 100; a longer one would store as `1e+22`.
                if (level.length > 2) continue;
                if (rawSubtree.header !== null) rawSubtree.target.push(rawSubtree.header);
                rawSubtree.header = null;
                rawSubtree.target.push(`${levelNum - rawSubtree.base}${trimmed.slice(level.length)}`);
                continue;
            }
            rawSubtree = null;
        }

        // Handle CONC (concatenate without newline) and CONT (concatenate with newline)
        if (tag === 'CONC' || tag === 'CONT') {
            if (lastValueRef) {
                const separator = tag === 'CONT' ? '\n' : '';
                const current = lastValueRef.obj[lastValueRef.key];
                lastValueRef.obj[lastValueRef.key] = (current || '') + separator + value;
            }
            continue;
        }

        // Capture MAP sub-structure: LATI / LONG lines attach coords to the most
        // recent PLAC value seen (best-effort — covers BIRT, DEAT, MARR, events).
        if (tag === 'LATI') {
            const lat = parseGedcomLat(value);
            if (lat !== null) {
                pendingLat = lat;
            }
            continue;
        }
        if (tag === 'LONG') {
            const lng = parseGedcomLng(value);
            if (lng !== null && pendingLat !== null && lastPlaceValue) {
                placeCoords.push({ name: lastPlaceValue, lat: pendingLat, lng });
            }
            pendingLat = null;
            continue;
        }

        // Whenever we see a PLAC line, track it (and its level) so LATI/LONG/NOTE
        // sub-structures can attach to it.
        // RootsMagic's `_EVDEF` writes `1 PLAC Y` ("this event takes a place"), which
        // is a flag, not a place (#969).
        if (tag === 'PLAC' && !inCustomRecord) {
            lastPlaceValue = value || null;
            lastPlaceLevel = lastPlaceValue !== null ? levelNum : null;
            pendingLat = null; // reset stale pending
            if (value) {
                if (!placeFormMap.has(value)) placeFormMap.set(value, null);
                lastPlaceName = value; // for a following PLAC.FORM
            }
            // `HEAD.PLAC` (no value of its own) — remember its level so the very
            // next `FORM` one level deeper is recognized as HEAD.PLAC.FORM, the
            // real GEDCOM 5.5.1 default-jurisdiction-hierarchy feature.
            if (inHeader) headerPlacLevel = levelNum;
        }

        // PLAC.FORM (jurisdiction format) — distinct from a media OBJE FORM, which
        // only fires when a media object is open. Under HEAD.PLAC it sets the
        // default form for all places (Slice 5); under any other place it sets
        // that place's own form. A FORM under some OTHER header substructure (e.g.
        // `HEAD.GEDC.FORM`, the file's dialect declaration) must NOT be mistaken
        // for the place-form default — gated on headerPlacLevel, not bare inHeader.
        if (tag === 'FORM' && !currentMedia && !currentObjeMedia && !currentObjeRec) {
            if (inHeader) {
                if (headerPlacLevel !== null && levelNum === headerPlacLevel + 1) headerPlaceForm = value || null;
            }
            else if (lastPlaceName && placeFormMap.has(lastPlaceName)) placeFormMap.set(lastPlaceName, value || null);
            continue;
        }

        // Leaving a citation's sub-tree closes it.
        if (currentCitation && levelNum <= currentCitationLevel) {
            currentCitation = null;
            currentCitationSub = null;
        }

        // A SOUR *pointer* (value starts with @) is a citation. `1 SOUR GenealogyApp`
        // in the header has no @, so it is ignored here.
        if (tag === 'SOUR' && value.startsWith('@') && !currentSource && !currentRepoXref) {
            let cit: ParsedFactCitation | null = null;
            // Only a dated, placed fact (BIRT, DEAT, MARR or an event) keeps the cited part.
            const part = levelNum === 3 ? openPart : null;
            const withPart = <T extends ParsedFactCitation>(c: T): T => (part ? { ...c, part } : c);
            // A citation on a NOTE or OBJE record has nowhere to go (#963): counted.
            if (!currentFamily && !currentPerson && !inHeader) citationsUnplaced++;
            if (currentFamily) {
                cit = { sourceXref: value, page: null, note: null, quay: null, dataText: null, dataDate: null, even: null, role: null };
                // A `2 SOUR` under an open family event (1 DIV / 1 ANUL / 1 SEPA / …)
                // binds to that event's fact citation, mirroring the person branch; a
                // family-level `1 SOUR` stays a whole-family citation. The levelNum
                // guard distinguishes the two even before the family block clears a
                // stale currentEvent (that clear runs later in the loop).
                if (levelNum >= 2 && currentEvent) {
                    cit = withPart(cit);
                    currentEvent.citations.push(cit);
                } else if (levelNum >= 2 && currentTag === 'MARR') {
                    // `1 MARR` / `2 SOUR` cites the marriage, not the whole family (#962).
                    const mc: ParsedFamilyCitation = withPart({ ...cit, factTable: 'FamilyMarriage' });
                    currentFamily.citations.push(mc);
                    cit = mc;
                } else {
                    currentFamily.citations.push(cit);
                }
            } else if (currentPerson) {
                if (levelNum >= 2 && currentEvent) {
                    cit = withPart({ sourceXref: value, page: null, note: null, quay: null, dataText: null, dataDate: null, even: null, role: null });
                    currentEvent.citations.push(cit);
                } else if (levelNum >= 2 && currentNameVariant) {
                    cit = { sourceXref: value, page: null, note: null, quay: null, dataText: null, dataDate: null, even: null, role: null };
                    (currentNameVariant.citations ??= []).push(cit);
                } else {
                    const factTable: ParsedPersonCitation['factTable'] =
                        levelNum >= 2 && currentTag === 'NAME' ? 'PersonName'
                        : levelNum >= 2 && currentTag === 'BIRT' ? 'PersonBirth'
                        : levelNum >= 2 && currentTag === 'DEAT' ? 'PersonDeath'
                        : 'People';
                    let pc: ParsedPersonCitation = { factTable, sourceXref: value, page: null, note: null, quay: null, dataText: null, dataDate: null, even: null, role: null };
                    if (factTable === 'PersonBirth' || factTable === 'PersonDeath') pc = withPart(pc);
                    currentPerson.citations.push(pc);
                    cit = pc;
                }
            }
            currentCitation = cit;
            currentCitationLevel = levelNum;
            currentCitationSub = null;
            // The citation's lines are its own, never an open fact's passthrough (#980).
            subRawCapturing = false;
            if (levelNum === 1) subRawTarget = null;
            continue;
        }

        // Children of an open citation attach to it (and never fall through to
        // person.Notes / event Description). Covers PAGE/NOTE plus the Slice 3
        // evidence fields: QUAY, EVEN/ROLE, and DATA.DATE/DATA.TEXT (spec p.39).
        if (currentCitation && levelNum > currentCitationLevel) {
            // A direct child (level cur+1) other than EVEN/DATA leaves any container.
            if (levelNum === currentCitationLevel + 1 && tag !== 'EVEN' && tag !== 'DATA') {
                currentCitationSub = null;
            }
            switch (tag) {
                case 'PAGE': currentCitation.page = value; lastValueRef = { obj: currentCitation as unknown as Record<string, unknown>, key: 'page' }; continue;
                case 'NOTE': currentCitation.note = value; lastValueRef = { obj: currentCitation as unknown as Record<string, unknown>, key: 'note' }; continue;
                case 'QUAY': currentCitation.quay = value; continue;
                case 'EVEN': currentCitation.even = value; currentCitationSub = 'EVEN'; continue;
                case 'ROLE': if (currentCitationSub === 'EVEN') { currentCitation.role = value; continue; } break;
                case 'DATA': currentCitationSub = 'DATA'; continue;
                case 'DATE': if (currentCitationSub === 'DATA') { currentCitation.dataDate = value; continue; } break;
                case 'TEXT': if (currentCitationSub === 'DATA') { currentCitation.dataText = value; lastValueRef = { obj: currentCitation as unknown as Record<string, unknown>, key: 'dataText' }; continue; } break;
                default: break;
            }
            // Any other direct child, such as media (#976), RootsMagic's `_FOOT` or a
            // `_TMPLT` subtree, rides the citation raw (#980).
            if (tag !== 'CONC' && tag !== 'CONT') {
                if (levelNum === currentCitationLevel + 1) {
                    const target = (currentCitation.rawLines ??= []);
                    target.push(`1${trimmed.slice(level.length)}`);
                    rawSubtree = { target, base: currentCitationLevel, level: levelNum, header: null };
                }
                // A deeper line, such as a DATE under the citation's EVEN, must not
                // reach the fact handlers below and overwrite the fact's own date.
                continue;
            }
        }

        // ── Family/source media (OBJE) — Slice 2 ───────────────────────────────────
        // Person OBJE is handled in processPersonTag (currentMedia, unchanged). The
        // blocks below model OBJE on families/sources and standalone `0 @O@ OBJE`
        // records, without touching the person path.

        // A new level-1 tag closes an open *inline* OBJE (its sub-lines are level ≥2).
        if (levelNum <= 1 && tag !== 'OBJE') { currentObjeMedia = null; currentObjeList = null; }
        // A pointer's optional substructure (currently legacy `_PRIM`) is scoped
        // to that one OBJE occurrence and must not bleed into its sibling.
        if (currentObjeRef && levelNum <= currentObjeRefLevel && tag !== 'OBJE') {
            currentObjeRef = null;
            currentObjeRefLevel = 0;
        }

        // Route OBJE sub-tags to the open media object: standalone records carry them
        // at level ≥1 (`0 @O@ OBJE` / `1 FILE`), inline media at level ≥2 (`1 OBJE` /
        // `2 FILE`). Only fires for family/source/standalone media — never person.
        // GEDCOM 5.5's embedded BLOB image isn't decoded into a stored file: counted (#977).
        if (tag === 'BLOB' && currentObjeRec && levelNum === 1) { mediaBlobsDropped++; continue; }
        if (currentObjeRec && levelNum <= 1) currentObjeInFile = false;
        // The first FILE's sub-lines the app doesn't model stay with the media row (#976).
        if (currentObjeRec && currentObjeInFile && levelNum === 2 && !MEDIA_SUBTAGS.has(tag)) {
            const target = (currentObjeRec.fileRawLines ??= []);
            target.push(`1${trimmed.slice(level.length)}`);
            rawSubtree = { target, base: 1, level: 2, header: null };
            continue;
        }
        if (MEDIA_SUBTAGS.has(tag)) {
            if (currentObjeRec && levelNum >= 1) {
                if (tag === 'FILE') {
                    // A standalone OBJE may contain multiple FILE subtrees. The
                    // first valid FILE owns the record's metadata; later FILEs
                    // must not mix their FORM/TITL into that first identity.
                    if (levelNum === 1 && !currentObjeRec.FilePath && value.trim()) {
                        currentObjeRec.FilePath = value;
                        currentObjeFileSubtree = true;
                        currentObjeFileClosed = false;
                        currentObjeInFile = true;
                        lastValueRef = { obj: currentObjeRec as unknown as Record<string, unknown>, key: 'FilePath' };
                    } else if (levelNum === 1 && currentObjeRec.FilePath) {
                        currentObjeFileClosed = true;
                    }
                }
                else if (tag === 'FORM') {
                    const firstSubtree = levelNum === 2 && currentObjeFileSubtree && !currentObjeFileClosed;
                    const legacyRecordLevel = levelNum === 1 && currentObjeFileSubtree && !currentObjeFileClosed;
                    if ((firstSubtree || legacyRecordLevel) && !currentObjeRec.Format) currentObjeRec.Format = value;
                    // FORM's own sub-lines (`3 TYPE`, `3 MEDI`) keep FORM with them (#976).
                    if (levelNum === 2 && currentObjeInFile) {
                        rawSubtree = { target: (currentObjeRec.fileRawLines ??= []), base: 1, level: 2, header: `1${trimmed.slice(level.length)}` };
                    }
                }
                else if (tag === 'TITL') {
                    const firstSubtree = levelNum === 2 && currentObjeFileSubtree && !currentObjeFileClosed;
                    const legacyRecordLevel = levelNum === 1 && currentObjeFileSubtree && !currentObjeFileClosed;
                    if ((firstSubtree || legacyRecordLevel) && !currentObjeRec.Title) {
                        currentObjeRec.Title = value;
                        lastValueRef = { obj: currentObjeRec as unknown as Record<string, unknown>, key: 'Title' };
                    }
                }
                else if (tag === '_PRIM') {
                    if (/^@.+@$/.test(value.trim())) currentObjeRec.primaryPersonXrefs.push(value.trim());
                    else currentObjeRec.legacyPrimary = value === 'Y' ? 1 : value === 'N' ? 0 : null;
                }
                else if (tag === '_FOCALX') {
                    const focalX = parseInt(value, 10);
                    if (!isNaN(focalX) && focalX >= 0 && focalX <= 100) currentObjeRec.FocalX = focalX;
                }
                else if (tag === '_FOCALY') {
                    const focalY = parseInt(value, 10);
                    if (!isNaN(focalY) && focalY >= 0 && focalY <= 100) currentObjeRec.FocalY = focalY;
                }
                else if (tag === '_FOCALR') {
                    const focalRadius = parseFloat(value);
                    if (!isNaN(focalRadius) && focalRadius >= 0 && focalRadius <= 500) currentObjeRec.FocalRadius = focalRadius;
                }
                continue;
            }
            if (currentObjeRef && levelNum > currentObjeRefLevel) {
                if (tag === '_PRIM') {
                    currentObjeRef.legacyPrimary = value === 'Y' ? 1 : value === 'N' ? 0 : null;
                }
                continue;
            }
            if (currentObjeMedia && levelNum >= 2) {
                lastValueRef = applyMediaSubTag(currentObjeMedia, currentObjeList ?? [], tag, value);
                continue;
            }
        }

        // An OBJE under a person's BIRT or DEAT, or a family's MARR, is that fact's
        // media (#905, ADR 0030). Those facts are columns, not Events rows, so it joins
        // the owner's own lists carrying the fact. Never the portrait: no primary.
        const vitalFact = tag === 'OBJE' && levelNum === 2 && !currentEvent
            ? currentPerson && currentTag === 'BIRT' ? 'Birth'
                : currentPerson && currentTag === 'DEAT' ? 'Death'
                    : currentFamily && currentTag === 'MARR' ? 'Marriage'
                        : null
            : null;
        if (vitalFact) {
            const owner = (currentPerson ?? currentFamily)!;
            if (/^@.+@$/.test(value)) {
                owner.mediaRefs.push({ xref: value.trim(), legacyPrimary: null, ownerFact: vitalFact });
                currentObjeRef = owner.mediaRefs[owner.mediaRefs.length - 1];
                currentObjeRefLevel = levelNum;
                currentObjeMedia = null; currentObjeList = null;
            } else {
                const m: ParsedMedia = { Title: null, FilePath: null, Format: null, legacyPrimary: null, xref: null, ownerFact: vitalFact };
                owner.media.push(m);
                currentObjeRef = null;
                currentObjeMedia = m; currentObjeList = owner.media;
            }
            continue;
        }

        // Start an inline OBJE on the CURRENT EVENT (2 OBJE under a 1 BIRT/DEAT/DIV/…).
        // GEDCOM 5.5.1 EVENT_DETAIL allows <<MULTIMEDIA_LINK>>. Must precede the
        // family/source branch so a family-event OBJE binds to the event, not the
        // family; and precede the person block (which would otherwise treat any
        // OBJE as person media regardless of level). The subtags route via the
        // shared currentObjeMedia/currentObjeList path below (levelNum ≥ 2).
        if (tag === 'OBJE' && levelNum >= 2 && currentEvent) {
            const ownerMedia = currentEvent.media;
            if (/^@.+@$/.test(value)) {
                currentEvent.mediaRefs.push({ xref: value.trim(), legacyPrimary: null });
                currentObjeRef = currentEvent.mediaRefs[currentEvent.mediaRefs.length - 1];
                currentObjeRefLevel = levelNum;
                currentObjeMedia = null; currentObjeList = null;
            } else {
                const m: ParsedMedia = { Title: null, FilePath: null, Format: null, legacyPrimary: ownerMedia.length === 0 ? 1 : 0, xref: null };
                ownerMedia.push(m);
                currentObjeRef = null;
                currentObjeMedia = m; currentObjeList = ownerMedia;
            }
            continue;
        }

        // Start an inline OBJE on a family or source (person OBJE handled later).
        if (tag === 'OBJE' && levelNum >= 1 && (currentFamily || currentSource)) {
            const ownerMedia = currentFamily ? currentFamily.media : currentSource!.media;
            if (/^@.+@$/.test(value)) {
                // Pointer to a standalone OBJE record, resolved after parsing.
                const ownerRefs = currentFamily ? currentFamily.mediaRefs : currentSource!.mediaRefs;
                ownerRefs.push({ xref: value.trim(), legacyPrimary: null });
                currentObjeRef = ownerRefs[ownerRefs.length - 1];
                currentObjeRefLevel = levelNum;
                currentObjeMedia = null; currentObjeList = null;
            } else {
                const m: ParsedMedia = { Title: null, FilePath: null, Format: null, legacyPrimary: ownerMedia.every((o) => o.ownerFact) ? 1 : 0, xref: null };
                ownerMedia.push(m);
                currentObjeRef = null;
                currentObjeMedia = m; currentObjeList = ownerMedia;
            }
            continue;
        }
        // ───────────────────────────────────────────────────────────────────────────

        // ── Sub-event passthrough capture (#423) ────────────────────────────────────
        // Runs after every other interceptor above has had a chance to claim the line
        // (LATI/LONG/PLAC/FORM, citation open/children, event/family/source OBJE) —
        // anything reaching here genuinely isn't modeled. BIRT/DEAT/MARR/an event's
        // own opening tag are always level 1, so a direct child is always level 2.
        if (subRawTarget && subRawHandled) {
            if (levelNum === 2) {
                // An inline `2 SOUR <text>` rides the fact's passthrough (#963).
                const inlineSour = tag === 'SOUR' && !value.startsWith('@');
                if (inlineSour) inlineCitationsKept++;
                // Heredis writes two `2 TYPE` lines under one `1 EVEN`, where 5.5.1
                // allows one. The first names the event; a repeat rides the
                // passthrough, as a repeated level-1 tag does (#513, #996).
                const repeatType = tag === 'TYPE' && currentEvent !== null && currentEvent.Type !== 'EVEN'
                    && (subRawHandled === HANDLED_PERSON_EVEN_L2 || subRawHandled === HANDLED_FAMILY_EVEN_L2);
                subRawCapturing = !subRawHandled.has(tag) || inlineSour || repeatType;
                if (subRawCapturing) { subRawTarget.push(trimmed); continue; }
            } else if (levelNum > 2 && subRawCapturing) {
                subRawTarget.push(trimmed);
                continue;
            } else if (levelNum <= 1) {
                subRawCapturing = false;
            }
        }
        // ───────────────────────────────────────────────────────────────────────────

        // A fact's place keeps its name, form, coordinates, notes and citations. Any
        // other line under it (ArkivDigital's `_ADPL` structured place) is lost:
        // counted, so the import report says so (#992).
        if (lastPlaceLevel !== null && levelNum === lastPlaceLevel + 1 && (currentPerson || currentFamily)
            && !PLACE_SUB_TAGS.has(tag)) placeLineTags.set(tag, (placeLineTags.get(tag) ?? 0) + 1);

        // An inline SOUR no passthrough above caught (under a NAME, say) is lost:
        // counted, so the import report says so (#963).
        if (tag === 'SOUR' && !value.startsWith('@') && (currentPerson || currentFamily)) citationsUnplaced++;

        // Handle level 0 records
        if (level === '0') {
            lastValueRef = null;
            lastPlaceValue = null;
            lastPlaceLevel = null;
            lastPlaceName = null;
            inHeader = tag === 'HEAD'; // header default PLAC.FORM lives here
            // A vendor's own level-0 record (Legacy `_EVENT_DEFN`, Family Origins
            // `_EVDEF`, Family Historian `_PLAC`) has no home here: counted (#967).
            const recordType = tag.startsWith('@') ? value.split(' ')[0] : tag;
            inCustomRecord = recordType.startsWith('_');
            if (tag.startsWith('@') && !recordTypes.has(tag)) recordTypes.set(tag, recordType);
            if (inCustomRecord) customRecordTags.set(recordType, (customRecordTags.get(recordType) ?? 0) + 1);
            pendingLat = null;
            // Save previous records
            if (currentPerson) people.push(currentPerson);
            if (currentFamily) families.push(currentFamily);
            if (currentSource) sources.push(currentSource);

            currentPerson = null;
            currentFamily = null;
            currentSource = null;
            currentRepoXref = null;
            currentEvent = null;
            legacyEnd = null;
            currentMedia = null;
            currentObjeMedia = null;
            currentObjeList = null;
            currentObjeRec = null;
            currentObjeFileSubtree = false;
            currentObjeFileClosed = false;
            currentObjeInFile = false;
            currentObjeRef = null;
            currentObjeRefLevel = 0;
            currentCitation = null;
            subRawTarget = null;
            subRawHandled = null;
            subRawCapturing = false;
            seenPromotedL1.clear(); // #513: "already seen" is per RECORD, not per file
            personNameSeen = false;
            currentNameVariant = null;
            if (tag.startsWith('@')) {
                if (recordXrefs.has(tag)) duplicateXrefs++;
                else recordXrefs.add(tag);
            }

            // Start new person: 0 @I1@ INDI
            if (tag.startsWith('@') && value === 'INDI') {
                currentPerson = {
                    gedcomId: tag,
                    FirstName: null,
                    LastName: null,
                    Sex: null,
                    GedcomId: tag,
                    BirthDate: null,
                    BirthPlace: null,
                    DeathDate: null,
                    DeathPlace: null,
                    DeathCause: null,
                    IsDeceased: null,
                    events: [],
                    media: [],
                    mediaRefs: [],
                    famcRefs: [],
                    // Keyed by pointer text from the file, so no prototype: a
                    // `1 FAMC constructor` must not resolve to Object's members.
                    famcPedi: Object.create(null),
                    famcRawLines: Object.create(null),
                    famsRefs: [],
                    citations: [],
                    notes: [],
                    nameVariants: [],
                    rawLines: [],
                    birthRawLines: [],
                    deathRawLines: [],
                    nameRawLines: [],
                };
                currentTag = 'INDI';
                continue;
            }

            // Start new family: 0 @F1@ FAM
            if (tag.startsWith('@') && value === 'FAM') {
                currentFamily = {
                    gedcomId: tag,
                    Partner1Id: null,
                    Partner2Id: null,
                    MarriageDate: null,
                    MarriagePlace: null,
                    extraPartnerRefs: [],
                    chilRefs: [],
                    // Keyed by pointer text from the file: no prototype (see famcPedi).
                    chilRelationships: Object.create(null),
                    chilFamcRaw: Object.create(null),
                    chilRawLines: Object.create(null),
                    partnerRawLines: Object.create(null),
                    events: [],
                    citations: [],
                    notes: [],
                    media: [],
                    mediaRefs: [],
                    rawLines: [],
                    marriageRawLines: [],
                };
                currentTag = 'FAM';
                continue;
            }

            // Start new source: 0 @S1@ SOUR
            if (tag.startsWith('@') && value === 'SOUR') {
                currentSource = {
                    xref: tag, Title: null, Author: null, PublicationInfo: null,
                    Text: null, Contents: null, Type: null, legacyToldBy: null, Num: null,
                    Abbreviation: null,
                    RepositoryName: null, repoXref: null, CallNumber: null,
                    Medi: null, RepositoryAddress: null,
                    notes: [],
                    media: [],
                    mediaRefs: [],
                    rawLines: [],
                };
                currentTag = 'SOUR';
                continue;
            }

            // Start new repository: 0 @R1@ REPO
            if (tag.startsWith('@') && value === 'REPO') {
                currentRepoXref = tag.trim();
                repoRecords.set(currentRepoXref, { address: null, rawLines: [], addrRawLines: [] });
                repoCapture = null;
                currentTag = 'REPO';
                continue;
            }

            // Start a standalone NOTE record: `0 @N1@ NOTE [text]`. Subordinate
            // CONC/CONT lines append to its text via lastValueRef.
            if (tag.startsWith('@') && (value === 'NOTE' || value.startsWith('NOTE '))) {
                const rec = { text: value === 'NOTE' ? '' : value.replace(/^NOTE /, '') };
                noteRecords.set(tag.trim(), rec);
                lastValueRef = { obj: rec as unknown as Record<string, unknown>, key: 'text' };
                currentTag = 'NOTE';
                continue;
            }

            // Start a standalone multimedia record: `0 @O1@ OBJE`. Its FILE/FORM/TITL
            // sub-lines (at level ≥1) are routed to currentObjeRec by the media block.
            if (tag.startsWith('@') && value === 'OBJE') {
                const rec: ParsedMediaRecord = {
                    xref: tag.trim(),
                    FilePath: null,
                    Format: null,
                    Title: null,
                    legacyPrimary: null,
                    primaryPersonXrefs: [],
                };
                objeRecords.set(tag.trim(), rec);
                currentObjeRec = rec;
                currentObjeFileSubtree = false;
                currentObjeFileClosed = false;
                currentTag = 'OBJE';
                continue;
            }

            continue;
        }

        // Process REPO record tags
        if (currentRepoXref) {
            if (tag === 'NAME') repoNames.set(currentRepoXref, value);
            else if (tag === 'ADDR') {
                // Slice 4; its CONT lines append to it (#966).
                const repo = repoRecords.get(currentRepoXref)!;
                repo.address = value;
                lastValueRef = { obj: repo as unknown as Record<string, unknown>, key: 'address' };
            }
            else if (tag === 'NOTE') {
                // REPOSITORY_RECORD +1 <<NOTE_STRUCTURE>> (ged551-2.txt:227-232).
                // Both forms, as everywhere else: an `@N@` pointer resolves after the
                // full parse, inline text carries a lastValueRef for CONC/CONT.
                const list = repoNotes.get(currentRepoXref) ?? [];
                if (/^@.+@$/.test(value)) {
                    list.push({ text: null, xref: value.trim() });
                } else {
                    const ref: ParsedNoteRef = { text: value, xref: null };
                    list.push(ref);
                    lastValueRef = { obj: ref as unknown as Record<string, unknown>, key: 'text' };
                }
                repoNotes.set(currentRepoXref, list);
            }
            continue;
        }

        // Process SOUR record tags
        if (currentSource) {
            switch (tag) {
                case 'TITL': currentSource.Title = value; lastValueRef = { obj: currentSource as unknown as Record<string, unknown>, key: 'Title' }; break;
                case 'AUTH': currentSource.Author = value; lastValueRef = { obj: currentSource as unknown as Record<string, unknown>, key: 'Author' }; break;
                case 'PUBL': currentSource.PublicationInfo = value; lastValueRef = { obj: currentSource as unknown as Record<string, unknown>, key: 'PublicationInfo' }; break;
                case 'TEXT': currentSource.Contents = value; lastValueRef = { obj: currentSource as unknown as Record<string, unknown>, key: 'Contents' }; break;
                case '_URL': currentSource.Text = value; lastValueRef = { obj: currentSource as unknown as Record<string, unknown>, key: 'Text' }; break;
                case '_TYPE': currentSource.Type = value; break;
                case '_TOLDBY': currentSource.legacyToldBy = value; lastValueRef = { obj: currentSource as unknown as Record<string, unknown>, key: 'legacyToldBy' }; break;
                case '_NUM': { const n = parseInt(value, 10); currentSource.Num = isNaN(n) ? null : n; break; }
                case 'REPO': if (value.startsWith('@')) currentSource.repoXref = value.trim(); break;
                case 'ABBR': currentSource.Abbreviation = value; lastValueRef = { obj: currentSource as unknown as Record<string, unknown>, key: 'Abbreviation' }; break;
                case 'CALN': currentSource.CallNumber = value; break;
                case 'MEDI': currentSource.Medi = value; break; // CALN.MEDI (Slice 4)
                case 'NOTE':
                    if (/^@.+@$/.test(value)) {
                        currentSource.notes.push({ text: null, xref: value.trim() });
                    } else {
                        const ref: ParsedNoteRef = { text: value, xref: null };
                        currentSource.notes.push(ref);
                        lastValueRef = { obj: ref as unknown as Record<string, unknown>, key: 'text' };
                    }
                    break;
            }
            continue;
        }

        // Process person tags
        if (currentPerson) {
            // A level-1 tag never lives inside an event, so it ends any open event
            // scope before its sub-records are processed. Without this a person-level
            // `1 NOTE` would bind to the previous event (the event-opening tags below
            // re-open the scope immediately after). Mirrors the family branch.
            if (levelNum === 1) {
                currentEvent = null;
                currentNameVariant = null;
            }

            // #872: a later `1 NAME` becomes a NameVariant rather than overwriting
            // the primary name. One that repeats the primary name adds nothing, so
            // its sub-records stay with the primary NAME scope.
            if (levelNum === 1 && tag === 'NAME') {
                if (personNameSeen) {
                    currentTag = 'NAME';
                    subRawTarget = null;
                    const name = nameVariantText(value);
                    const primary = nameVariantText(`${currentPerson.FirstName ?? ''} ${currentPerson.LastName ?? ''}`);
                    if (name && name !== primary) {
                        currentNameVariant = { Type: 'Alias', Name: name };
                        currentPerson.nameVariants.push(currentNameVariant);
                    }
                    continue;
                }
                personNameSeen = true;
            }
            if (levelNum === 2 && tag === 'TYPE' && currentNameVariant) {
                currentNameVariant.Type = NAME_TYPE_TO_VARIANT[value.trim().toLowerCase()] ?? 'Alias';
                continue;
            }

            const ref = processPersonTag(currentPerson, tag, value, currentTag, currentEvent, currentMedia, levelNum, currentFamcRef);
            if (ref) lastValueRef = ref;

            // Update current context.
            //
            // LEVEL-GUARDED (Q9). Every arm below opens or closes a person-level
            // scope, so it must only fire for a level-1 line. Without this guard a
            // nested line whose tag happens to match — "3 ADOP HUSB" inside an
            // adoption record, "2 EVEN" under an inline SOUR citation — is treated
            // as a new top-level fact and fabricates an event. The DEAT arm is in
            // here too, so an unguarded nested DEAT could flip IsDeceased.
            // Sub-records are handled by processPersonTag above, which is called
            // unconditionally and reads currentTag/currentEvent for context.
            if (levelNum === 1) {
                if (tag === 'NAME') {
                    currentTag = 'NAME';
                    currentEvent = null;
                    subRawTarget = currentPerson.nameRawLines;
                    subRawHandled = HANDLED_NAME_L2;
                } else if (tag === 'BIRT' || tag === 'DEAT') {
                    currentTag = tag;
                    currentEvent = null;
                    // Ancestris, Legacy and Family Origins write a bare `1 BIRT` (#968).
                    if (tag === 'BIRT') currentPerson.BirthRecorded = 1;
                    if (tag === 'DEAT') {
                        // DEAT N = explicitly living; DEAT / DEAT Y = deceased
                        currentPerson.IsDeceased = value === 'N' ? 0 : 1;
                    }
                    // #423: BIRT/DEAT are People columns, not an Events row, so the
                    // record-level capture never reaches their children (BIRT/DEAT are
                    // themselves handled level-1 tags) — sweep unmodeled sub-tags
                    // (CAUS, AGE, AGNC, RESN, …) into a dedicated array instead, kept
                    // separate from the record-level rawLines (see birthRawLines/
                    // deathRawLines doc comment) so the generator can re-emit them
                    // nested under the right `1 BIRT`/`1 DEAT` line, not dangling at
                    // the end of the record.
                    subRawTarget = tag === 'DEAT' ? currentPerson.deathRawLines : currentPerson.birthRawLines;
                    subRawHandled = HANDLED_COLUMN_EVENT_L2;
                } else if (tag === '_LIVING') {
                    // Our own explicitly-living marker, replacing the illegal
                    // "1 DEAT N" (Q2). The DEAT N read above stays for files
                    // exported before that change.
                    currentTag = '_LIVING';
                    currentPerson.IsDeceased = 0;
                    currentEvent = null;
                    subRawTarget = null;
                } else if (['OCCU', 'EDUC', 'RESI', 'BURI', 'CHR', 'BAPM', 'ADOP', 'EVEN', 'GRAD', 'EMIG', 'IMMI', 'NATU', 'CENS', 'RETI', 'PROB', 'WILL'].includes(tag)) {
                    currentTag = tag;
                    // `|| null`: a valueless opening line (`1 EVEN`, the generic form
                    // whose label rides a subordinate TYPE) otherwise stores an empty
                    // string where the record had null, so a custom event fails to
                    // round-trip cleanly. The family path already normalises this way.
                    currentEvent = { UserId: 0, Type: tag, Description: value || null, Date: null, Place: null, PersonId: null, FamilyId: null, Id: 0, citations: [], media: [], mediaRefs: [], notes: [], rawLines: [] };
                    currentPerson.events.push(currentEvent);
                    subRawTarget = currentEvent.rawLines;
                    subRawHandled = tag === 'EVEN' ? HANDLED_PERSON_EVEN_L2 : HANDLED_PERSON_EVENT_L2;
                } else if (tag === 'OBJE') {
                    currentTag = 'OBJE';
                    // A pointer remains a reference to the standalone record. Only
                    // an inline block allocates an owner-local ParsedMedia value.
                    // Leaving the event scope here (and clearing the shared event-OBJE
                    // pointers) stops a following 2 FILE from binding to a prior event's
                    // media instead of this person photo.
                    currentEvent = null;
                    currentObjeMedia = null;
                    currentObjeList = null;
                    if (/^@.+@$/.test(value)) {
                        currentPerson.mediaRefs.push({ xref: value.trim(), legacyPrimary: null });
                        currentObjeRef = currentPerson.mediaRefs[currentPerson.mediaRefs.length - 1];
                        currentObjeRefLevel = levelNum;
                        currentMedia = null;
                    } else {
                        currentObjeRef = null;
                        currentMedia = { Title: null, FilePath: null, Format: null, xref: null, legacyPrimary: currentPerson.media.every((o) => o.ownerFact) ? 1 : 0 };
                        currentPerson.media.push(currentMedia);
                    }
                    subRawTarget = null;
                } else if ((tag === 'NICK' || tag === '_AKA') && value.trim()) {
                    // The variant processPersonTag just added; a `2 SOUR` under it
                    // cites that variant, as under a later `1 NAME` (#963).
                    currentTag = tag;
                    currentNameVariant = currentPerson.nameVariants[currentPerson.nameVariants.length - 1];
                    subRawTarget = null;
                } else if (tag === 'FAMC') {
                    // A child-to-family link keeps its unmodeled sub-lines per link,
                    // so they re-emit under this same `1 FAMC` (#954).
                    currentTag = tag;
                    subRawTarget = (currentPerson.famcRawLines[value] ??= []);
                    subRawHandled = HANDLED_FAMC_L2;
                } else {
                    // Every other level-1 tag also ends the open BIRT/DEAT/NAME fact,
                    // so its sub-lines can't bind to it: a `2 DATE` under a TMG
                    // `1 NOTE` that follows `1 BIRT` overwrote the birth date (#959).
                    currentTag = tag;
                    // Every other level-1 tag (SEX, FAMS, NOTE, SOUR, …) opens no
                    // sub-raw scope, so it must CLOSE any still-open one. Without this a
                    // `2 PEDI` under a `1 FAMC` that follows a `1 DEAT` is swept into
                    // deathRawLines by the #423 sub-event capture — which runs earlier in
                    // the loop than this dispatch — and re-emitted, misattached, under
                    // `1 DEAT` on export.
                    subRawTarget = null;
                    subRawCapturing = false;
                }
                // Track the open `1 FAMC` so a subordinate `2 PEDI` binds to that
                // specific child-to-family link (a person can be a child of several).
                currentFamcRef = tag === 'FAMC' ? value : null;
            }
        }

        // Process family tags
        if (currentFamily) {
            const lvl = parseInt(level, 10);
            // A level-1 tag that is neither MARR nor a family-event tag ends any open
            // event scope, so its sub-records (and following L1 lines) don't bind to a
            // prior event.
            if (lvl === 1 && tag !== 'MARR' && tag !== '_ENDED' && tag !== '_ENDREASON'
                && !FAMILY_EVENT_TAGS.has(tag)) {
                currentEvent = null;
                currentTag = '';
                subRawTarget = null;
            }

            const ref = processFamilyTag(currentFamily, tag, value, currentTag, currentEvent);
            if (ref) lastValueRef = ref;

            // Marriage is the anchor (Families.MarriageDate); every other family-event
            // tag becomes an Events row whose DATE/PLAC/NOTE/TYPE sub-records bind to it.
            if (tag === 'MARR' && lvl === 1) {
                currentTag = 'MARR';
                currentEvent = null;
                // Legacy, FTM and PAF write a bare `1 MARR` (or `1 MARR Y`) for a
                // marriage with no date; it is still a marriage (#965).
                currentFamily.MarriageRecorded = 1;
                // #423: same reasoning as person BIRT/DEAT above — a dedicated array,
                // not the shared record-level rawLines, so the generator can nest it
                // under `1 MARR` specifically.
                subRawTarget = currentFamily.marriageRawLines;
                subRawHandled = HANDLED_COLUMN_EVENT_L2;
            } else if (FAMILY_EVENT_TAGS.has(tag) && lvl === 1) {
                currentTag = tag;
                // `DIV N` / `ANUL N` never get here: they ride the passthrough (#991).
                const desc = value && value !== 'Y' && value !== 'N' ? value : null;
                currentEvent = { UserId: 0, Type: tag, Description: desc, Date: null, Place: null, PersonId: null, FamilyId: null, Id: 0, citations: [], media: [], mediaRefs: [], notes: [], rawLines: [] };
                currentFamily.events.push(currentEvent);
                subRawTarget = currentEvent.rawLines;
                subRawHandled = tag === 'EVEN' ? HANDLED_FAMILY_EVEN_L2 : HANDLED_FAMILY_EVENT_L2;
            } else if (tag === '_ENDED' && lvl === 1) {
                // Legacy app-export end date. Seed a placeholder end-event; the following
                // _ENDREASON line resolves its type (or discards it if redundant/derived).
                currentTag = '';
                // `?? value` for the same reason as the DATE cases (#400): this also
                // lands in Events."Date", so an unparseable legacy value would be
                // dropped rather than kept as text.
                legacyEnd = { UserId: 0, Type: 'EVEN', Description: null, Date: parseDate(value) ?? value, Place: null, PersonId: null, FamilyId: null, Id: 0, citations: [], media: [], mediaRefs: [], notes: [], rawLines: [] };
                currentFamily.events.push(legacyEnd);
                currentEvent = legacyEnd;
                subRawTarget = null;
            } else if (tag === '_ENDREASON' && lvl === 1) {
                resolveLegacyFamilyEnd(currentFamily, legacyEnd, value);
                legacyEnd = null;
                currentEvent = null;
                subRawTarget = null;
                currentTag = '';
            } else if (tag === 'CHIL' && lvl === 1) {
                // A child link keeps its sub-lines per link, so they re-emit under
                // this same `1 CHIL` (#961).
                subRawTarget = (currentFamily.chilRawLines[value] ??= []);
                subRawHandled = HANDLED_CHIL_L2;
            } else if ((tag === 'HUSB' || tag === 'WIFE') && lvl === 1) {
                // A partner's sub-lines (Legacy's `2 _PREF Y`) stay with that
                // partner (#989). A third partner is already a raw `1 HUSB` line,
                // so its sub-lines follow it there.
                const kept = currentFamily.husbRef === value || currentFamily.wifeRef === value;
                subRawTarget = kept ? (currentFamily.partnerRawLines[value] ??= []) : currentFamily.rawLines;
                subRawHandled = HANDLED_PARTNER_L2;
            }
        }
    }

    // Save last person/family/source
    if (currentPerson) people.push(currentPerson);
    if (currentFamily) families.push(currentFamily);
    if (currentSource) sources.push(currentSource);

    // #470: the teller of an oral source is its author. Folded once CONC/CONT are in.
    for (const s of sources) s.Author = foldToldBy(s.Author, s.legacyToldBy);

    // Resolve PEDI into each family's per-child relationship type (ADR 0012).
    // GEDCOM records pedigree on the CHILD's `INDI.FAMC`, but this importer builds
    // FamilyPerson rows from the FAM side, so the value has to cross over here —
    // after both records have been seen, since either may come first in the file.
    const familyByXref = new Map(families.map((f) => [f.gedcomId, f]));
    // Links (`family child`) with a value that has no type, and the distinct values
    // for the warning, case-insensitively, first spelling kept.
    const unmappedChildRelationshipLinks = new Set<string>();
    const unmappedChildRelationshipValues = new Map<string, string>();
    const noteUnmapped = (family: ParsedFamily, childRef: string, value: string): void => {
        unmappedChildRelationshipLinks.add(`${family.gedcomId} ${childRef}`);
        if (!unmappedChildRelationshipValues.has(value.toLowerCase())) {
            unmappedChildRelationshipValues.set(value.toLowerCase(), value);
        }
    };
    for (const p of people) {
        for (const famcRef of new Set([...Object.keys(p.famcPedi), ...Object.keys(p.famcRawLines)])) {
            const family = familyByXref.get(famcRef);
            if (!family) continue;
            const raw = p.famcRawLines[famcRef] ?? [];
            const pedi = p.famcPedi[famcRef]?.trim();
            const relType = pedi ? PEDI_TO_RELATIONSHIP_TYPE[pedi.toLowerCase()] : undefined;
            if (relType) {
                family.chilRelationships[p.gedcomId] = { partner1: relType, partner2: relType };
            } else if (pedi) {
                // Unmapped (`step`, `sealing`, a vendor value): PEDI is one value for
                // the link, so it can't say which partner is the step-parent. The link
                // stays at the default rather than inventing a type (ADR 0012), and
                // the value rides the link's passthrough so export writes it back (#954).
                raw.unshift(`2 PEDI ${pedi}`);
                noteUnmapped(family, p.gedcomId, pedi);
            }
            if (raw.length > 0) family.chilFamcRaw[p.gedcomId] = raw.join('\n');
        }
    }
    // FTM's per-parent `_FREL` / `_MREL` (#961, #982): `_FREL` is the HUSB's
    // (Partner1) relationship and `_MREL` the WIFE's (Partner2). Each sets its own
    // partner and wins over PEDI there, since it says more. A line with a type
    // leaves the passthrough, because export writes it from the columns again; a
    // value with no type (Related, Sealed, Private) stays raw and is reported.
    for (const family of families) {
        for (const [childRef, raw] of Object.entries(family.chilRawLines)) {
            const pedi = family.chilRelationships[childRef];
            const next: ChildRelationships = { partner1: pedi?.partner1 ?? 'Birth', partner2: pedi?.partner2 ?? 'Birth' };
            const seen = { partner1: false, partner2: false };
            const kept: string[] = [];
            for (let i = 0; i < raw.length; i++) {
                const m = /^2 _([FM])REL (.+)$/.exec(raw[i]);
                const slot = m?.[1] === 'F' ? 'partner1' : 'partner2';
                const relType = m ? FTM_VALUE_TO_CHILD_RELATIONSHIP[m[2].trim().toLowerCase()] : undefined;
                if (m && relType && !seen[slot]) {
                    next[slot] = relType;
                    seen[slot] = true;
                    // Lines under it go with it.
                    while (i + 1 < raw.length && /^[3-9] /.test(raw[i + 1])) i++;
                    continue;
                }
                if (m && !relType) noteUnmapped(family, childRef, m[2].trim());
                kept.push(raw[i]);
            }
            if (seen.partner1 || seen.partner2) {
                family.chilRelationships[childRef] = next;
                family.chilRawLines[childRef] = kept;
            }
        }
    }

    // Resolve repository names + addresses from the REPO records (Slice 4).
    for (const s of sources) {
        if (s.repoXref) {
            s.RepositoryName = repoNames.get(s.repoXref) ?? s.RepositoryName;
            s.RepositoryAddress = repoRecords.get(s.repoXref)?.address?.trim() || null;
        }
    }

    // Resolve NOTE-record pointers to their text now that every `0 @N@ NOTE`
    // record has been seen. Inline notes already carry their text. Drop refs that
    // resolved to nothing (dangling pointer / empty record) so no `@N@` leaks.
    const resolveNote = (ref: ParsedNoteRef): void => {
        if (ref.xref && !noteRecords.has(ref.xref)) danglingPointers.note++;
        if (ref.xref && (ref.text === null || ref.text === '')) {
            ref.text = noteRecords.get(ref.xref)?.text ?? null;
        }
    };
    const hasText = (ref: ParsedNoteRef): boolean => !!(ref.text && ref.text.trim());

    // Repository notes, re-keyed from `@Rn@` to the repository NAME (ADR 0012).
    // The importer creates repositories by name (`findOrCreateRepository`), so the
    // xref — meaningful only within this one file — cannot be the join key. A REPO
    // with no NAME has nothing to attach to and is skipped.
    const repositoryNotes: Array<{ name: string; notes: ParsedNoteRef[] }> = [];
    const repositories: ParsedRepository[] = [];
    for (const [xref, repo] of repoRecords) {
        const name = repoNames.get(xref)?.trim();
        if (name) repositories.push({ xref, name, address: repo.address?.trim() || null, rawLines: repo.rawLines, addrRawLines: repo.addrRawLines });
    }
    for (const [xref, refs] of repoNotes) {
        const name = repoNames.get(xref)?.trim();
        if (!name) continue;
        refs.forEach(resolveNote);
        const resolved = refs.filter(hasText);
        if (resolved.length > 0) repositoryNotes.push({ name, notes: resolved });
    }
    for (const f of families) {
        f.notes.forEach(resolveNote);
        f.notes = f.notes.filter(hasText);
    }
    for (const s of sources) {
        s.notes.forEach(resolveNote);
        s.notes = s.notes.filter(hasText);
    }
    // Event-level notes (4.1) — resolve `@N@` pointers and drop empties, same as
    // family/source notes. Both person and family events carry the field.
    for (const p of people) {
        for (const evt of p.events) {
            evt.notes.forEach(resolveNote);
            evt.notes = evt.notes.filter(hasText);
        }
    }
    for (const f of families) {
        for (const evt of f.events) {
            evt.notes.forEach(resolveNote);
            evt.notes = evt.notes.filter(hasText);
        }
    }
    // Person notes are first-class now (ADR 0010) — resolved and filtered exactly
    // like family/source notes, so a note shared with a family stays ONE note
    // instead of being copied into the person's scalar column.
    for (const p of people) {
        p.notes.forEach(resolveNote);
        p.notes = p.notes.filter(hasText);
    }

    // Keep pointed media as owner references. The persistence layer consumes the
    // record map once, then creates one owner link per reference occurrence. Only
    // pointers to an absent xref are discarded; an ownerless or file-less record is
    // still a real ParsedMediaRecord and remains available to the importer.
    const resolveMediaRefs = (refs: ParsedMediaRef[]): ParsedMediaRef[] => {
        const kept = refs.filter((ref) => objeRecords.has(ref.xref));
        danglingPointers.media += refs.length - kept.length;
        return kept;
    };
    for (const p of people) {
        p.mediaRefs = resolveMediaRefs(p.mediaRefs);
        for (const evt of p.events) evt.mediaRefs = resolveMediaRefs(evt.mediaRefs);
    }
    for (const f of families) {
        f.mediaRefs = resolveMediaRefs(f.mediaRefs);
        for (const evt of f.events) evt.mediaRefs = resolveMediaRefs(evt.mediaRefs);
    }
    for (const s of sources) s.mediaRefs = resolveMediaRefs(s.mediaRefs);

    // Names and places get the same normalizer the API uses (#884), after CONC
    // and CONT have been joined, so an imported value equals what an edit sends back.
    for (const p of people) {
        p.FirstName = normalizeNameOrNull(p.FirstName);
        p.LastName = normalizeNameOrNull(p.LastName);
        p.BirthPlace = normalizeNameOrNull(p.BirthPlace);
        p.DeathPlace = normalizeNameOrNull(p.DeathPlace);
        p.nameVariants = p.nameVariants
            .map((nv) => ({ ...nv, Name: normalizeNameText(nv.Name) }))
            .filter((nv) => nv.Name);
        for (const evt of p.events) evt.Place = normalizeNameOrNull(evt.Place);
    }
    for (const f of families) {
        f.MarriagePlace = normalizeNameOrNull(f.MarriagePlace);
        for (const evt of f.events) evt.Place = normalizeNameOrNull(evt.Place);
    }
    for (const c of placeCoords) c.name = normalizeNameText(c.name);
    for (const n of placeNotes) n.name = normalizeNameText(n.name);

    // Distinct places with their form (per-place form, else the header default).
    // Two spellings that normalize alike keep the first one's form.
    const placeForms = new Map<string, string | null>();
    for (const [raw, form] of placeFormMap) {
        const name = normalizeNameText(raw);
        if (name && !placeForms.has(name)) placeForms.set(name, form);
    }
    const places = Array.from(placeForms.entries()).map(([name, form]) => ({
        name,
        form: form ?? headerPlaceForm,
    }));

    // Resolve place-note `@N@` pointers and drop empties, same as family/event notes.
    placeNotes.forEach(resolveNote);
    const resolvedPlaceNotes = placeNotes.filter(hasText);

    // Dedup by (name, xref) for pointer-based notes: the exporter emits one
    // `3 NOTE @Nx@` per PLAC occurrence of a place, all pointing at the SAME
    // shared `0 @Nx@ NOTE` record — a place referenced by K records otherwise
    // produces K duplicate entries here, which the persistence layer would
    // then insert as K separate Note rows (amplifying by K every round-trip).
    // Inline notes (xref === null) are independently-authored per-occurrence
    // text, not the amplification vector, so they are left untouched.
    const seenPlaceNoteKeys = new Set<string>();
    const dedupedPlaceNotes = resolvedPlaceNotes.filter((n) => {
        if (n.xref === null) return true;
        const key = `${n.name} ${n.xref}`;
        if (seenPlaceNoteKeys.has(key)) return false;
        seenPlaceNoteKeys.add(key);
        return true;
    });

    return {
        people,
        families,
        placeCoords,
        places,
        placeNotes: dedupedPlaceNotes,
        sources,
        repositoryNotes,
        repositories,
        mediaRecords: Array.from(objeRecords.values()),
        danglingPointers: countRecordPointers(people, families, sources, danglingPointers),
        duplicateXrefs,
        unmappedChildRelationships: {
            count: unmappedChildRelationshipLinks.size,
            values: [...unmappedChildRelationshipValues.values()],
        },
        inlineCitationsKept,
        citationsUnplaced,
        customRecordsDropped: {
            count: [...customRecordTags.values()].reduce((a, b) => a + b, 0),
            tags: [...customRecordTags.keys()],
        },
        mediaBlobsDropped,
        notesUnattached: [...noteRecords.keys()].filter((xref) => !pointedAt.has(xref)).length,
        placeLinesDropped: {
            count: [...placeLineTags.values()].reduce((a, b) => a + b, 0),
            tags: [...placeLineTags.keys()],
        },
        recordTypes,
    };
}

/** Pointers to records missing from the file, by the kind of record they name. */
export interface DanglingPointerCounts {
    source: number;
    note: number;
    media: number;
    family: number;
    person: number;
}

/**
 * Add the SOUR, FAMC/FAMS and HUSB/WIFE/CHIL pointers that name no record in the
 * file to `counts` (NOTE and OBJE are counted while they resolve). The importer
 * drops each of these, and used to say nothing about it (#880). Only `@X@`
 * pointers count: an inline `1 SOUR text` citation is a different structure.
 */
function countRecordPointers(
    people: ParsedPerson[],
    families: ParsedFamily[],
    sources: ParsedSource[],
    counts: DanglingPointerCounts,
): DanglingPointerCounts {
    const personXrefs = new Set(people.map((p) => p.gedcomId));
    const familyXrefs = new Set(families.map((f) => f.gedcomId));
    const sourceXrefs = new Set(sources.map((s) => s.xref));
    const isPointer = (value: string) => /^@[^@]+@$/.test(value.trim());
    const citations = (list: Array<{ sourceXref: string }> | undefined) => {
        for (const c of list ?? []) if (isPointer(c.sourceXref) && !sourceXrefs.has(c.sourceXref)) counts.source++;
    };
    for (const p of people) {
        citations(p.citations);
        for (const evt of p.events) citations(evt.citations);
        for (const nv of p.nameVariants) citations(nv.citations);
        for (const ref of [...p.famcRefs, ...p.famsRefs]) if (!familyXrefs.has(ref)) counts.family++;
    }
    for (const f of families) {
        citations(f.citations);
        for (const evt of f.events) citations(evt.citations);
        const partners = [f.husbRef, f.wifeRef, ...f.extraPartnerRefs, ...f.chilRefs];
        for (const ref of partners) if (ref && !personXrefs.has(ref)) counts.person++;
    }
    return counts;
}

/**
 * Family life-cycle event tags that become Events rows (Phase 2). MARR is excluded —
 * it stays the marriage anchor on the Families row (MarriageDate/MarriagePlace). Each
 * of these opens an event whose DATE/PLAC/NOTE/TYPE sub-records bind to it.
 */
const FAMILY_EVENT_TAGS = new Set(['DIV', 'ANUL', 'ENGA', 'MARB', 'MARC', 'MARL', 'MARS', 'DIVF', 'CENS', 'RESI', 'EVEN']);

/**
 * Resolve a legacy `_ENDREASON` line (older app exports) into the events model.
 * Divorce/Annulment already have a standard `1 DIV`/`1 ANUL` event, and Death is
 * derived from partner DeathDate — in those cases the placeholder seeded by `_ENDED`
 * is discarded. Separation/Unknown/other reasons synthesize an event, carrying the
 * placeholder's date.
 */
function resolveLegacyFamilyEnd(family: ParsedFamily, placeholder: ParsedEvent | null, reason: string): void {
    const END_EVENT_TYPES = new Set(['DIV', 'DIVF', 'ANUL', 'SEPA']);
    const date = placeholder?.Date ?? null;
    if (placeholder) {
        const i = family.events.indexOf(placeholder);
        if (i >= 0) family.events.splice(i, 1);
    }
    if (reason === 'Death') return; // derived from partner DeathDate, not a family event
    const hasStdEnd = family.events.some((e) => END_EVENT_TYPES.has(e.Type));
    if ((reason === 'Divorce' || reason === 'Annulment') && hasStdEnd) return; // standard tag already captured it
    const type = reason === 'Divorce' ? 'DIV'
        : reason === 'Annulment' ? 'ANUL'
        : reason === 'Separation' ? 'SEPA'
        : 'EVEN';
    family.events.push({ UserId: 0, Type: type, Description: type === 'EVEN' ? reason : null, Date: date, Place: null, PersonId: null, FamilyId: null, Id: 0, citations: [], media: [], mediaRefs: [], notes: [], rawLines: [] });
}

type ValueRef = { obj: Record<string, unknown>; key: string } | null;

/**
 * Apply one OBJE sub-tag to a family/source inline media object (Slice 2).
 * Returns a ValueRef for FILE/TITL so CONC/CONT can extend them. `_PRIM Y` makes
 * this the owner's primary, clearing siblings — mirroring the person-media path.
 */
function applyMediaSubTag(media: ParsedMedia, mediaList: ParsedMedia[], tag: string, value: string): ValueRef {
    switch (tag) {
        case 'FILE':
            if (!media.FilePath && value.trim()) {
                media.FilePath = value;
                return { obj: media as unknown as Record<string, unknown>, key: 'FilePath' };
            }
            return null;
        case 'FORM':
            media.Format = value;
            return null;
        case 'TITL':
            media.Title = value;
            return { obj: media as unknown as Record<string, unknown>, key: 'Title' };
        case '_PRIM':
            // `N` is an explicit negative, not an unknown value (#401). Without this
            // arm the first-photo default seeded at creation stands, so a file that
            // states "not primary" is overridden by our own guess.
            if (value === 'Y') { mediaList.forEach((m) => (m.legacyPrimary = 0)); media.legacyPrimary = 1; }
            else if (value === 'N') { media.legacyPrimary = 0; }
            return null;
        case '_FOCALX': { const n = parseInt(value, 10); if (!isNaN(n) && n >= 0 && n <= 100) media.FocalX = n; return null; }
        case '_FOCALY': { const n = parseInt(value, 10); if (!isNaN(n) && n >= 0 && n <= 100) media.FocalY = n; return null; }
        case '_FOCALR': { const n = parseFloat(value); if (!isNaN(n) && n >= 0 && n <= 500) media.FocalRadius = n; return null; }
        default:
            return null;
    }
}

function processPersonTag(
    person: ParsedPerson,
    tag: string,
    value: string,
    currentTag: string,
    currentEvent: ParsedEvent | null,
    currentMedia: ParsedMedia | null,
    /** The line's GEDCOM level, for tags whose meaning depends on depth. */
    level: number,
    /** The open `1 FAMC` link, so a subordinate `2 PEDI` binds to the right one. */
    currentFamcRef: string | null
): ValueRef {
    switch (tag) {
        case 'NAME': {
            const nameParts = value.split('/');
            person.FirstName = nameParts[0]?.trim() || null;
            if (nameParts.length > 1 && nameParts[1]?.trim()) {
                person.LastName = nameParts[1].trim();
            }
            return null;
        }

        case 'SEX':
            person.Sex = value;
            return null;

        case 'DATE': {
            // `?? value` on every branch (#400). `parseDate` returns null for free
            // text such as "circa the war", and a bare assignment therefore DELETED
            // it — DATE ∈ HANDLED_COLUMN_EVENT_L2 (:172), so the #423 passthrough
            // does not catch it either. Keeping the raw text is lossless; the event
            // branch additionally stops storing raw GEDCOM for dates it CAN parse,
            // which is what left Events."Date" holding mixed formats.
            const parsedDate = parseDate(value);
            if (currentTag === 'BIRT') {
                person.BirthDate = parsedDate ?? value;
            } else if (currentTag === 'DEAT') {
                person.DeathDate = parsedDate ?? value;
            } else if (currentEvent) {
                currentEvent.Date = parsedDate ?? value;
            }
            return null;
        }

        case 'PLAC':
            if (currentTag === 'BIRT') {
                person.BirthPlace = value;
                return { obj: person as unknown as Record<string, unknown>, key: 'BirthPlace' };
            } else if (currentTag === 'DEAT') {
                person.DeathPlace = value;
                return { obj: person as unknown as Record<string, unknown>, key: 'DeathPlace' };
            } else if (currentEvent) {
                currentEvent.Place = value;
                return { obj: currentEvent as unknown as Record<string, unknown>, key: 'Place' };
            }
            return null;

        case 'CAUS':
            if (currentTag === 'DEAT') {
                person.DeathCause = value;
                return { obj: person as unknown as Record<string, unknown>, key: 'DeathCause' };
            }
            return null;

        case 'TYPE':
            // `2 TYPE <label>` names a custom `1 EVEN`. INDIVIDUAL_EVENT_STRUCTURE
            // gives the generic EVEN tag no inline value slot, so the subordinate
            // TYPE is the only place the label can live (ged551-2.txt:490-508).
            // Guarded to the generic form only: TYPE is legal under EVERY event
            // (EVENT_DETAIL, :448-449), and under a standard tag it qualifies the
            // event rather than naming it — overwriting there would turn a
            // `1 BURI` / `2 TYPE Cremation` into an event of type "Cremation".
            // Anything not claimed here stays passthrough (HANDLED_PERSON_EVENT_L2).
            if (currentEvent && currentEvent.Type === 'EVEN') currentEvent.Type = value;
            return null;

        case 'FILE':
            if (currentMedia) {
                if (!currentMedia.FilePath && value.trim()) {
                    currentMedia.FilePath = value;
                    return { obj: currentMedia as unknown as Record<string, unknown>, key: 'FilePath' };
                }
                return null;
            }
            return null;

        case 'FORM':
            if (currentMedia) {
                currentMedia.Format = value;
            }
            return null;

        case 'TITL':
            if (currentMedia) {
                currentMedia.Title = value;
                return { obj: currentMedia as unknown as Record<string, unknown>, key: 'Title' };
            }
            return null;

        case '_PRIM':
            // See applyMediaSubTag: `N` is an explicit negative (#401).
            if (currentMedia && value === 'Y') {
                person.media.forEach(m => m.legacyPrimary = 0);
                currentMedia.legacyPrimary = 1;
            } else if (currentMedia && value === 'N') {
                currentMedia.legacyPrimary = 0;
            }
            return null;

        case '_FOCALX':
            if (currentMedia) {
                const fx = parseInt(value, 10);
                if (!isNaN(fx) && fx >= 0 && fx <= 100) {
                    currentMedia.FocalX = fx;
                }
            }
            return null;

        case '_FOCALY':
            if (currentMedia) {
                const fy = parseInt(value, 10);
                if (!isNaN(fy) && fy >= 0 && fy <= 100) {
                    currentMedia.FocalY = fy;
                }
            }
            return null;

        case '_FOCALR':
            if (currentMedia) {
                const fr = parseFloat(value);
                if (!isNaN(fr) && fr >= 0 && fr <= 500) {
                    currentMedia.FocalRadius = fr;
                }
            }
            return null;

        case 'NOTE':
            // A `2 NOTE` under an open person event attaches to that event as a
            // note link (4.1) instead of polluting the person's biography. For
            // non-value person events, inline text is the generator's legal
            // representation of Events.Description; pointers remain note links.
            if (currentEvent) {
                if (/^@.+@$/.test(value)) {
                    currentEvent.notes.push({ text: null, xref: value.trim() });
                    return null;
                }
                if (PERSON_EVENT_INLINE_DESCRIPTION_TYPES.has(currentTag)) {
                    currentEvent.Description = currentEvent.Description
                        ? currentEvent.Description + '\n' + value
                        : value;
                    return { obj: currentEvent as unknown as Record<string, unknown>, key: 'Description' };
                }
                const eventNote: ParsedNoteRef = { text: value, xref: null };
                currentEvent.notes.push(eventNote);
                return { obj: eventNote as unknown as Record<string, unknown>, key: 'text' };
            }
            // Only a `2 NOTE` belongs to the open BIRT/DEAT. A `1 NOTE` is the
            // person's whatever came before it; currentTag still names the previous
            // fact here, because the level-1 dispatch runs after this (#959).
            const personFact = level >= 2 && currentTag === 'BIRT' ? 'Birth'
                : level >= 2 && currentTag === 'DEAT' ? 'Death'
                    : undefined;
            // A person-level note is now a first-class Note + NoteLink('People')
            // like every other owner (ADR 0010), rather than being folded into the
            // scalar People."Notes" column — which forked a note shared between a
            // person and their family into two unrelated notes. An `@N@` pointer
            // keeps its xref so the shared record resolves after the full parse and
            // stays ONE note; inline text carries a lastValueRef for CONC/CONT.
            if (/^@.+@$/.test(value)) {
                person.notes.push({ text: null, xref: value.trim(), ownerFact: personFact });
                return null;
            }
            const personNote: ParsedNoteRef = { text: value, xref: null, ownerFact: personFact };
            person.notes.push(personNote);
            return { obj: personNote as unknown as Record<string, unknown>, key: 'text' };

        // NICK and _AKA become first-class NameVariant rows. They used to be appended
        // to Notes as "NICK: Bill" text, which round-tripped fine but meant nothing in
        // the app could read them — the nickname display path keys off NameVariant, so
        // every imported nickname was invisible.
        case 'NICK': {
            const nick = value.trim();
            if (nick) person.nameVariants.push({ Type: 'Nickname', Name: nick });
            return null;
        }

        case '_AKA': {
            const aka = value.trim();
            if (aka) person.nameVariants.push({ Type: 'Alias', Name: aka });
            return null;
        }

        case 'FAMC':
            // Level-guarded (Q10): a "2 FAMC" inside an adoption record names the
            // adopting family and belongs to that event, not to the person's
            // child-to-family links.
            if (level === 1) person.famcRefs.push(value);
            return null;

        case 'PEDI':
            // `2 PEDI <birth|adopted|foster|sealing>` under a `1 FAMC` is the
            // child's pedigree linkage for THAT family (CHILD_TO_FAMILY_LINK,
            // ged551-2.txt:351-357). Level-guarded for the same reason as FAMC
            // above: a `3 PEDI` under an ADOP event's `2 FAMC` describes the
            // event, not the person's real child link. Stored raw and mapped to
            // RelationshipType after the parse, once families are known.
            if (level === 2 && currentFamcRef) person.famcPedi[currentFamcRef] = value;
            return null;

        case 'FAMS':
            // Level-guarded, mirroring the FAMC guard above: nested FAMS is
            // non-standard (spouse-family links are level-1 only in 5.5.1).
            if (level === 1) person.famsRefs.push(value);
            return null;

        default:
            return null;
    }
}

function processFamilyTag(
    family: ParsedFamily,
    tag: string,
    value: string,
    currentTag: string,
    currentEvent: ParsedEvent | null
): ValueRef {
    switch (tag) {
        // #873: several apps write a same-sex couple as two WIFE or two HUSB
        // lines, and the second used to overwrite the first. A pointer takes its
        // own tag's slot when free. A second pointer of the same tag makes the
        // pair keep file order (first → Partner1). A third partner has no column,
        // so it stays raw and the import reports it.
        case 'HUSB':
        case 'WIFE': {
            const own = tag === 'HUSB' ? 'husbRef' : 'wifeRef';
            // A repeated pointer to the same person is one partner, not two.
            if (family.husbRef === value || family.wifeRef === value) return null;
            if (!family[own]) family[own] = value;
            else if (tag === 'HUSB' && !family.wifeRef) family.wifeRef = value;
            else if (tag === 'WIFE' && !family.husbRef) {
                family.husbRef = family.wifeRef;
                family.wifeRef = value;
            } else {
                family.extraPartnerRefs.push(value);
                family.rawLines.push(`1 ${tag} ${value}`);
            }
            return null;
        }

        case 'CHIL':
            // #874: a source app's merge can leave the same CHIL twice. One child
            // link per family is all FamilyPerson can hold, so keep the first.
            if (!family.chilRefs.includes(value)) family.chilRefs.push(value);
            return null;

        case '_FTYPE':
            family.Type = value as ParsedFamily['Type'];
            return null;

        // _ENDED / _ENDREASON (legacy column echo) and DIV / ANUL (event tags) are
        // handled in the main loop, which owns the currentEvent scope. They fall
        // through to the default no-op here.

        case 'TYPE':
            // `2 TYPE <label>` under a `1 EVEN` names a non-standard family event.
            // Same generic-only guard as the person path: a `1 DIV` / `2 TYPE Civil`
            // must stay a divorce. (This guard is new — the family case was
            // unguarded before ADR 0013, so the defect predates the person fix.)
            if (currentEvent && currentEvent.Type === 'EVEN') currentEvent.Type = value;
            return null;

        case 'DATE': {
            // Mirror of the person path above — same `?? value` rule (#400).
            const parsedDate = parseDate(value);
            if (currentTag === 'MARR') {
                family.MarriageDate = parsedDate ?? value;
            } else if (currentEvent) {
                currentEvent.Date = parsedDate ?? value;
            }
            return null;
        }

        case 'PLAC':
            if (currentTag === 'MARR') {
                family.MarriagePlace = value;
                return { obj: family as unknown as Record<string, unknown>, key: 'MarriagePlace' };
            } else if (currentEvent) {
                currentEvent.Place = value;
                return { obj: currentEvent as unknown as Record<string, unknown>, key: 'Place' };
            }
            return null;

        case 'NOTE':
            // A family-level `1 NOTE` is a shared-note pointer or inline text.
            // Under an open family event: a `2 NOTE @N@` pointer is a shared note
            // attached to the event (4.1); inline `2 NOTE` text stays the event's
            // description, since family events have no value slot on the event line
            // (distinct from the person-event model, where inline notes are notes).
            if (currentEvent) {
                if (/^@.+@$/.test(value)) {
                    currentEvent.notes.push({ text: null, xref: value.trim() });
                    return null;
                }
                currentEvent.Description = currentEvent.Description
                    ? currentEvent.Description + '\n' + value
                    : value;
                return { obj: currentEvent as unknown as Record<string, unknown>, key: 'Description' };
            }
            const familyFact = currentTag === 'MARR' ? 'Marriage' : undefined;
            if (/^@.+@$/.test(value)) {
                family.notes.push({ text: null, xref: value.trim(), ownerFact: familyFact });
                return null;
            } else {
                const ref: ParsedNoteRef = { text: value, xref: null, ownerFact: familyFact };
                family.notes.push(ref);
                return { obj: ref as unknown as Record<string, unknown>, key: 'text' };
            }

        default:
            return null;
    }
}

/** GEDCOM approximation/range prefixes that wrap a date (spec p.45-46). */
const DATE_PREFIX_QUALIFIERS: Record<string, string> = {
    ABT: 'ABT', ABOUT: 'ABT', CIRCA: 'ABT', CA: 'ABT', // about
    EST: 'EST', CAL: 'CAL', BEF: 'BEF', AFT: 'AFT', INT: 'INT',
};

/**
 * Parses a GEDCOM date value to a stored partial-precision string, PRESERVING
 * approximation/range qualifiers instead of dropping them (GED-4). The inner
 * date(s) are normalized to ISO; the qualifier keyword is kept as a prefix so
 * `formatDateForGedcom` can re-emit a spec-valid date on export.
 *   "26 AUG 1819"        → "1819-08-26"
 *   "ABT 1850"           → "ABT 1850"
 *   "BEF 3 MAR 1900"     → "BEF 1900-03-03"
 *   "BET 1850 AND 1860"  → "BET 1850 AND 1860"
 *   "FROM 1850 TO 1860"  → "FROM 1850 TO 1860"
 */
export function parseDate(dateStr: string): string | null {
    if (!dateStr || !dateStr.trim()) return null;
    const trimmed = dateStr.trim();

    // A bare parenthesised DATE_PHRASE is a legal DATE_VALUE (ged551-3.txt:415-421).
    // Tested before the token split so "(abt the time of the fire)" is never read
    // as an ABT date — that would re-export as invalid GEDCOM and hand the user
    // back an altered copy of their own file.
    if (trimmed.length >= 2 && trimmed.startsWith('(') && trimmed.endsWith(')')) {
        return trimmed;
    }

    const toks = trimmed.split(/\s+/);
    const up0 = toks[0].toUpperCase();

    // Range: BET <d1> AND <d2>
    if (up0 === 'BET') {
        const i = toks.findIndex((x) => x.toUpperCase() === 'AND');
        if (i > 1 && i < toks.length - 1) {
            const d1 = parsePlainDate(toks.slice(1, i).join(' '));
            const d2 = parsePlainDate(toks.slice(i + 1).join(' '));
            if (d1 && d2) return `BET ${d1} AND ${d2}`;
        }
    }
    // Range: FROM <d1> TO <d2>  (or open-ended FROM <d1> / TO <d2>)
    if (up0 === 'FROM') {
        const i = toks.findIndex((x) => x.toUpperCase() === 'TO');
        if (i > 1 && i < toks.length - 1) {
            const d1 = parsePlainDate(toks.slice(1, i).join(' '));
            const d2 = parsePlainDate(toks.slice(i + 1).join(' '));
            if (d1 && d2) return `FROM ${d1} TO ${d2}`;
        }
        const d1 = parsePlainDate(toks.slice(1).join(' '));
        if (d1) return `FROM ${d1}`;
    }
    if (up0 === 'TO' && toks.length > 1) {
        const d2 = parsePlainDate(toks.slice(1).join(' '));
        if (d2) return `TO ${d2}`;
    }
    // Prefix qualifier: ABT/EST/CAL/BEF/AFT/INT <date>
    const qual = DATE_PREFIX_QUALIFIERS[up0];
    if (qual && toks.length > 1) {
        const rest = toks.slice(1).join(' ');
        // INT (interpreted) may carry a "(phrase)"; keep its remainder verbatim.
        if (qual === 'INT') return `INT ${rest}`;
        const inner = parsePlainDate(rest);
        return inner ? `${qual} ${inner}` : `${qual} ${rest}`; // keep raw rather than drop
    }

    return parsePlainDate(trimmed);
}

const GEDCOM_MONTHS: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};
// February allows 29 in any year: before 1752 an English date is Julian, where
// 1700 was a leap year, and this parser does not know the calendar.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Parse a plain (unqualified) GEDCOM date to the ISO partial-precision form.
 *
 * Each shape is anchored to the WHOLE string and the day is range-checked
 * (#876). This used to be a prefix parser built on `parseInt`, so "11 FEB
 * 1712/13" lost its dual year, "500 B.C." became AD 500, "1850?" lost its
 * doubt and "30 FEB 1900" was stored as an impossible ISO date. Anything left
 * over now returns null, and `parseDate`'s callers keep the original text
 * verbatim, which data checks list as unreadable.
 */
function parsePlainDate(dateStr: string): string | null {
    const trimmed = dateStr.trim().replace(/\s+/g, ' ');
    let m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{1,4})$/.exec(trimmed);
    if (m) {
        const day = Number(m[1]);
        const month = GEDCOM_MONTHS[m[2].toUpperCase()];
        const year = Number(m[3]);
        if (!month || year <= 0 || day < 1 || day > DAYS_IN_MONTH[Number(month) - 1]) return null;
        return `${year}-${month}-${String(day).padStart(2, '0')}`;
    }
    m = /^([A-Za-z]{3}) (\d{1,4})$/.exec(trimmed);
    if (m) {
        const month = GEDCOM_MONTHS[m[1].toUpperCase()];
        const year = Number(m[2]);
        return month && year > 0 ? `${year}-${month}` : null;
    }
    m = /^(\d{1,4})$/.exec(trimmed);
    if (m) {
        const year = Number(m[1]);
        return year > 0 && year < 3000 ? `${year}` : null;
    }
    return null;
}
