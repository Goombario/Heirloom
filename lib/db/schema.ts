// Database schema interfaces matching the C# models

import type { MediaOwnerFact, MediaOwnerTable } from './fact-tables';

export interface User {
    Id: number;
    Email: string;
    Name: string | null;
    Image: string | null;
    GoogleId: string;
    CreatedAt: string;
    UpdatedAt: string;
}

/**
 * Multi-tree: a user account can hold several separate trees. "TreeId" on the
 * entity tables below is the scope column (backfilled from the owner columns —
 * see init-schema.ts); the legacy UserId/OwnerId columns keep recording the
 * owning USER. Optional (`?`) because pre-backfill/orphaned rows may be null.
 */
export interface Tree {
    Id: number;
    OwnerId: number;
    Name: string;
    CreatedAt: string;
    UpdatedAt: string;
}

export interface NewTree {
    OwnerId: number;
    Name: string;
}

export interface TreeSharing {
    Id: number;
    OwnerId: number;
    SharedWithId: number;
    /** The shared tree. Nullable in the row type for pre-backfill rows only —
     *  new shares always carry a TreeId (see NewTreeSharing). */
    TreeId: number | null;
    Permission: 'view' | 'contribute' | 'edit';
    CreatedAt: string;
}

/** A share for an address with no account yet (#1228); first sign-in turns it into TreeSharing. */
export interface PendingShare {
    Id: number;
    OwnerId: number;
    TreeId: number;
    /** Normalised (trimmed, lower case). */
    Email: string;
    Permission: 'view' | 'contribute' | 'edit';
    CreatedAt: string;
}

export interface Person {
    Id: number;
    UserId: number;
    TreeId?: number | null;
    FirstName: string | null;
    LastName: string | null;
    Sex: string | null;
    GedcomId: string | null;
    BirthDate: string | null;
    BirthPlace: string | null;
    DeathDate: string | null;
    DeathPlace: string | null;
    /** The gazetteer place of the birth (#1167); BirthPlace is a copy of the name the
     *  references pick (#1186). Optional: fixtures and pre-v61 rows may not carry it. */
    BirthPlaceId?: number | null;
    /** The place's other name the birth is written under; null for its own name (#1186). */
    BirthPlaceNameId?: number | null;
    /** As BirthPlaceId, for DeathPlace. */
    DeathPlaceId?: number | null;
    DeathPlaceNameId?: number | null;
    /** Cause of death promoted from GEDCOM `2 CAUS` (#480); optional for legacy read fixtures. */
    DeathCause?: string | null;
    IsDeceased: number | null; // null = unknown, 0 = alive, 1 = deceased
    // No `Notes`: the People."Notes" column was dropped in #524 (ADR 0010).
    // People own notes through Note + NoteLink('People') like every other owner.
    UpdatedAt: string | null;
    /** Added by migration; serialized to an ISO string over HTTP (a Date server-side). */
    CreatedAt?: string;
    /** Verbatim GEDCOM subtrees not yet modeled, preserved for lossless export round-trip (passthrough). */
    RawGedcom?: string | null;
    /** Verbatim sub-tags of the imported `1 BIRT` this parser does not model (#423) — kept
     *  separate from RawGedcom so it re-emits nested under BIRT, not dangling at record end. */
    BirthRawGedcom?: string | null;
    /** Same as BirthRawGedcom, for `1 DEAT` (e.g. `2 CAUS <cause of death>`) (#423). */
    DeathRawGedcom?: string | null;
    /** Sub-lines of the primary `1 NAME` the app doesn't model (NPFX, NSFX, SPFX, TYPE, …), re-emitted under it (#964). */
    NameRawGedcom?: string | null;
    /** 1 when the imported INDI had a bare `1 BIRT` (no date, place or anything else), so it exports back (#968). */
    BirthRecorded?: number | null;
}

/**
 * Read-time view of a Person augmented with the two computed display columns
 * (`EffectiveFirstName`, `Nickname`). These are populated by display read
 * queries and consumed by `lib/utils/names.ts` helpers — they are NOT columns
 * and must never be spread into an UPDATE/INSERT. Write paths use {@link Person}
 * or {@link NewPerson}.
 */
export interface PersonDisplay extends Person {
    /** Primary name variant's name when one is marked, else FirstName. */
    EffectiveFirstName: string | null;
    /** Preferred name when it is a nickname (primary variant of Type 'Nickname'). */
    Nickname: string | null;
}

export type FamilyType = 'Marriage' | 'Civil union' | 'Common-law' | 'Other' | 'Unknown';
export type FamilyEndedReason = 'Death' | 'Divorce' | 'Separation' | 'Annulment' | 'Unknown';

export interface Family {
    Id: number;
    UserId: number;
    TreeId?: number | null;
    Partner1Id: number | null;
    Partner2Id: number | null;
    MarriageDate: string | null;
    MarriagePlace: string | null;
    /** The gazetteer place MarriagePlace names (#1167). */
    MarriagePlaceId?: number | null;
    /** The other name MarriagePlace is written under (#1186). */
    MarriagePlaceNameId?: number | null;
    Type?: FamilyType | null;
    UpdatedAt: string | null;
    /** Verbatim GEDCOM subtrees not yet modeled, preserved for lossless export round-trip (passthrough). */
    RawGedcom?: string | null;
    /** Verbatim sub-tags of the imported `1 MARR` this parser does not model (#423) — kept
     *  separate from RawGedcom so it re-emits nested under MARR, not dangling at record end. */
    MarriageRawGedcom?: string | null;
    /** 1 when the imported FAM had a bare `1 MARR` (no date, place or anything else), so it exports back (#965). */
    MarriageRecorded?: number | null;
    /** Verbatim sub-lines of the imported partner's `1 HUSB` / `1 WIFE` (Legacy's `2 _PREF Y`),
     *  re-emitted under that partner's line. Cleared when a user changes the partner (#989). */
    Partner1RawGedcom?: string | null;
    Partner2RawGedcom?: string | null;
}

export interface GedcomEvent {
    Id: number;
    UserId: number;
    TreeId?: number | null;
    Type: string;
    Date: string | null;
    Place: string | null;
    /** The gazetteer place Place names (#1167). */
    PlaceId?: number | null;
    /** The other name Place is written under (#1186). */
    PlaceNameId?: number | null;
    Description: string | null;
    PersonId: number | null;
    FamilyId: number | null;
    /** Verbatim GEDCOM subtrees not yet modeled, preserved for lossless export round-trip (passthrough). */
    RawGedcom?: string | null;
}

/** A timeline event plus its attachments: media (MediaLink OwnerTable='Events')
 *  and how many notes hang off it (NoteLink OwnerTable='Events'). Both fields are
 *  optional so plain `GedcomEvent[]` consumers stay compatible. `noteCount` is a
 *  count, not the notes themselves — the timeline only needs to know WHETHER a row
 *  has notes; the rail fetches the text on demand when a row is opened. */
export type EventWithMedia = GedcomEvent & { media?: Media[]; noteCount?: number };

export interface Media {
    Id: number;
    UserId: number;
    TreeId?: number | null;
    Title: string | null;
    /** When the photo was taken: free text, like an event date (#802). */
    Date?: string | null;
    FilePath: string | null;
    /** The FILE text a GEDCOM import declared, verbatim; null for uploads (#958). */
    SourceFile?: string | null;
    /** FILE sub-lines a GEDCOM import didn't model, levels relative to FILE (#976). */
    FileRawGedcom?: string | null;
    Format: string | null;
    ContentType: string | null;
    FocalX?: number; // 0-100, default 50 (center)
    FocalY?: number; // 0-100, default 50 (center)
    FocalRadius?: number | null; // percentage of min(nW,nH)/2 for crop circle radius; null = no crop
    FileSize?: number; // bytes; 0 for placeholder records before file upload
    /** SHA-256 hex of the ORIGINAL uploaded bytes; null for rows predating #592. */
    ContentHash?: string | null;
    /** Tree-scoped replay key for create-time staged uploads; null for ordinary uploads. */
    UploadIntentId?: string | null;
    /** Immutable normalized target snapshot paired with UploadIntentId; operational only. */
    UploadIntentTarget?: string | null;
    /** Not a column: how many face candidates this upload staged (#487). */
    FacesFound?: number;
}

export type MediaImportStatus = 'pending' | 'ready' | 'missing' | 'failed';

export type MediaImportFailureCode =
    | 'archive_file_missing'
    | 'archive_path_mismatch'
    | 'unsupported_media_type'
    | 'file_too_large'
    | 'storage_capacity'
    | 'decode_failed'
    | 'materialization_failed'
    | 'legacy_materialization_unknown';

/** Durable lineage and materialization state for one imported media file. */
export interface MediaImportItem {
    id: number;
    importId: string;
    documentMediaId: string;
    treeId: number;
    mediaId: number;
    archivePath: string;
    originalFilename: string;
    status: MediaImportStatus;
    failureCode: MediaImportFailureCode | null;
    skipFaceCapture: boolean;
}

export interface NewMediaImportItem {
    importId: string;
    documentMediaId: string;
    treeId: number;
    mediaId: number;
    archivePath: string;
    originalFilename: string;
    status?: MediaImportStatus;
    failureCode?: MediaImportFailureCode | null;
    skipFaceCapture?: boolean;
}

// Source and Citation types are defined alongside their queries — see the
// authoritative `Source`/`NewSource` in `lib/db/queries/sources.ts` and
// `Citation`/`NewCitation` in `lib/db/queries/citations.ts`. They are kept there
// (not here) because their column sets — OwnerId, Type, Contents, the
// FactTable/FactId citation link — evolve with the library/citation system.

export interface Case {
    Id: number;
    UserId: number;
    TreeId?: number | null;
    Title: string;
    Description: string | null;
    Status: 'in_progress' | 'on_hold' | 'closed';
    Tags: string[];
    CreatedAt: string;
    UpdatedAt: string;
    /** The case's scope (#58, ADR 0045): from/to years and a focus place. */
    FromYear?: number | null;
    ToYear?: number | null;
    Place?: string | null;
    /** The kind of question the case started as ('moved', 'parents', … or 'own'). */
    QuestionKind?: string | null;
    /** Set when the case closes: answered, ruled out or unresolved. */
    Outcome?: CaseOutcome | null;
    ClosedAt?: string | null;
}

export type CaseOutcome = 'answered' | 'ruled_out' | 'unresolved';

export interface NewCase {
    UserId: number;
    TreeId?: number | null;
    Title: string;
    Description?: string | null;
    Status?: 'in_progress' | 'on_hold' | 'closed';
    Tags?: string[];
    FromYear?: number | null;
    ToYear?: number | null;
    Place?: string | null;
    QuestionKind?: string | null;
}

/** A case citation is now a Citation row (FactTable='Cases') referencing a library Source. */
export interface CaseCitation {
    Id: number;
    CaseId: number;
    SourceId: number;
    Note: string | null;
    /** The citation detail (page or line), certainty and transcription (#918). */
    Page: string | null;
    Quay: string | null;
    DataText: string | null;
    Url: string | null;
    sourceTitle: string | null;
    sourceType: string | null;
    sourceUrl: string | null;
    sourceRepo: string | null;
}

/**
 * A journal entry the app writes (#801). A status entry's Body is the status the
 * case moved to, or 'reopened' when it left Closed; a conclusion's Body is the
 * researcher's answer, written when the case closes. The research workspace (#58,
 * ADR 0045) adds `finding` (a record added; Body is its title), `search` (nothing
 * found; Body is what was searched), `request` and `reply` (Body is what was
 * asked for), and `lead` (Body is 'added', 'settled', 'reopened' or 'dropped',
 * filed under that lead).
 */
export type CaseCommentKind = 'status' | 'conclusion' | 'finding' | 'search' | 'request' | 'reply' | 'lead';
export type CaseStatusEntry = 'in_progress' | 'on_hold' | 'closed' | 'reopened';

export interface CaseComment {
    Id: number;
    CaseId: number;
    UserId: number;
    Body: string;
    CreatedAt: string;
    /** Null for a researcher's note. */
    Kind?: CaseCommentKind | null;
    UserName?: string | null;
    UserEmail?: string | null;
    MediaId?: number | null;
    media?: Media | null;
    /** Source-citation attached to this entry (FactTable 'CaseComments'). Label = source title. */
    citationId?: number | null;
    citationSourceId?: number | null;
    citationLabel?: string | null;
    /**
     * Set when a researcher's note was struck out as no longer accurate (#1251,
     * ADR 0042). Entries are never edited or deleted; a struck one stays in place.
     */
    StruckAt?: string | null;
    /** Who struck it; null when that account is gone. */
    StruckBy?: number | null;
    StruckByName?: string | null;
    StruckReason?: string | null;
    /** The finding or request an app-written entry is about (#58). */
    FindingId?: number | null;
    RequestId?: number | null;
    /** The leads the entry is filed under; empty for the whole case (#58). */
    leadIds?: number[];
}

export interface PersonResult {
    Id: number;
    FirstName: string | null;
    LastName: string | null;
    Sex: string | null;
    BirthDate: string | null;
    DeathDate: string | null;
    BirthPlace?: string | null;
    EffectiveFirstName?: string | null;
    Nickname?: string | null;
    PrimaryMediaId?: number;
    FocalX?: number;
    FocalY?: number;
    FocalRadius?: number | null;
    /** Search only: the first parent family's partners, and the first partner. */
    ParentName1?: string | null;
    ParentName2?: string | null;
    PartnerName?: string | null;
}

export interface MediaWithPerson extends Media {
    PersonFirstName?: string | null;
    PersonLastName?: string | null;
    /** Effective first name (primary variant if set) — for display joins. */
    PersonEffectiveFirstName?: string | null;
    /** Preferred nickname, when the primary variant is a nickname. */
    PersonNickname?: string | null;
    /** Names of people tagged in this photo (for library search by person). */
    TaggedPersonNames?: string[];
    /** Numeric IDs of people tagged in this photo (for owner-context ranking). */
    TaggedPersonIds?: number[];
    /** Names of the people the row is linked to: a document's people, who have no face tags (#510). */
    LinkedPersonNames?: string[];
    /** How many people the row is linked to (#510). */
    LinkedPersonCount?: number;
    /** How many records of any kind the row is linked to; 0 shows a document as "Not linked" (#510). */
    LinkCount?: number;
}

export interface MediaTag {
    Id: number;
    MediaId: number;
    PersonId: number;
    RegionX: number; // top-left X, % of image (0-100)
    RegionY: number; // top-left Y, % of image (0-100)
    RegionW: number; // width, % of image (0-100)
    RegionH: number; // height, % of image (0-100)
    CreatedAt?: string;
}

export interface MediaTagWithPerson extends MediaTag {
    PersonFirstName: string | null;
    PersonLastName: string | null;
    /** Effective first name (primary variant if set) — for display joins. */
    PersonEffectiveFirstName?: string | null;
    /** Preferred nickname, when the primary variant is a nickname. */
    PersonNickname?: string | null;
    /** Derived from the matching canonical People MediaLink; never stored on MediaTag. */
    IsPersonPrimary: boolean;
}

export type NewMediaTag = Omit<MediaTag, 'Id' | 'CreatedAt'>;

export interface MediaLinkIntegrityIssue {
    kind:
        | 'invalid_owner_table'
        | 'missing_owner'
        | 'cross_tree_owner'
        | 'multiple_primary';
    mediaId: number;
    ownerTable: string;
    ownerId: number | null;
}

export interface MediaLinkIntegrityReport {
    issues: MediaLinkIntegrityIssue[];
}

/**
 * `chosen` is the one kind no matcher ever produces: it records that a HUMAN
 * pointed this candidate at a person (#487 "Someone else…"). The review page
 * re-runs matching on every load, so without a kind that means "decided", a
 * re-point would be silently overwritten by the next re-derivation.
 */
export type FaceMatchKind = 'exact' | 'variant' | 'ambiguous' | 'none' | 'chosen';
type FaceCandidateStatus = 'pending' | 'confirmed' | 'dismissed';
export type FaceDismissReason = 'not-a-face' | 'unidentified';

/** An unconfirmed face region read from a photo's own metadata (#487). */
export interface MediaFaceCandidate {
    Id: number;
    MediaId: number;
    TreeId: number;
    RegionX: number; // top-left X, % of image (0-100)
    RegionY: number;
    RegionW: number;
    RegionH: number;
    /** The name written in the photo, verbatim. Null for an unnamed region. */
    SourceName: string | null;
    SuggestedPersonId: number | null;
    MatchKind: FaceMatchKind;
    Status: FaceCandidateStatus;
    /** Set only when THIS feature created the tag — the condition undo needs. */
    ConfirmedTagId: number | null;
    DismissReason: FaceDismissReason | null;
    /** The photo's title, joined for the queue's face strips (#1126). */
    MediaTitle?: string | null;
    /** The photo's date as recorded, and how many people it shows (#1156). */
    MediaDate?: string | null;
    MediaPeopleCount?: number;
    ResolvedAt?: string | null;
    CreatedAt?: string;
}

/** A media row annotated for a person's gallery (owned + tagged photos). */
export interface PersonGalleryMedia extends Media {
    IsOwned: boolean;
    IsTaggedHere: boolean;
    IsPersonPrimary: boolean;
    /** The person's facts the photo is linked to (Birth, Death), shown as its label (ADR 0030). */
    OwnerFacts?: MediaOwnerFact[];
    TagRegionX: number | null;
    TagRegionY: number | null;
    TagRegionW: number | null;
    TagRegionH: number | null;
}

/** A media row in an owner context, with explicit-link and family-inference capabilities. */
export interface OwnerGalleryMedia extends Media {
    /** Linked to the record itself, so it can be removed from this list. */
    IsExplicit: boolean;
    IsInferred: boolean;
    /** The facts of this record the photo is linked to, shown as its label (ADR 0030). */
    OwnerFacts?: MediaOwnerFact[];
}

/**
 * One record a media row is linked to, with what the viewer needs to name it
 * (#510 "Linked to"). Person names come for People links, both partners for
 * Families, the source title for Sources, and the event's type for Events.
 * `FactDate` is the date of the linked fact or event, when there is one.
 */
export interface MediaLinkOwner {
    OwnerTable: MediaOwnerTable;
    OwnerId: number;
    OwnerFact: MediaOwnerFact | null;
    PersonId: number | null;
    FirstName: string | null;
    LastName: string | null;
    EffectiveFirstName?: string | null;
    Nickname?: string | null;
    Partner2FirstName: string | null;
    Partner2LastName: string | null;
    SourceTitle: string | null;
    EventType: string | null;
    FactDate: string | null;
}

/** A person on a case or a lead, as the workspace shows them. */
export interface CasePersonRef {
    Id: number;
    FirstName: string | null;
    LastName: string | null;
    EffectiveFirstName?: string | null;
    Nickname?: string | null;
    Sex: string | null;
    PrimaryMediaId?: number;
    FocalX?: number;
    FocalY?: number;
    FocalRadius?: number | null;
}

/**
 * A lead (#58, ADR 0045): a sub-question of a case with its own people and years.
 * Its status is worked out by `leadStatus`, never stored.
 */
export interface CaseLead {
    Id: number;
    CaseId: number;
    Question: string;
    FromYear: number | null;
    ToYear: number | null;
    Position: number;
    CreatedAt: string;
    SettledAt: string | null;
    DroppedAt: string | null;
    people: CasePersonRef[];
}

export type CaseClaimDecision = 'accepted' | 'rejected' | 'undecided';
export type CaseClaimEvidence = 'direct' | 'indirect' | 'negative';

/** One thing a record says, decided in place (#58). */
export interface CaseClaim {
    Id: number;
    FindingId: number;
    Position: number;
    /** A fact key ('BIRT', 'RESI', …) or free text. */
    What: string;
    /** The person it is about, when they are in the tree. */
    PersonId: number | null;
    /** The name the record gives someone not in the tree yet. */
    PersonName: string | null;
    /** The tree's name for `PersonId`, for display. */
    personLabel?: string | null;
    Says: string | null;
    Date: string | null;
    Place: string | null;
    Evidence: CaseClaimEvidence | null;
    Decision: CaseClaimDecision;
    DecidedAt: string | null;
    AppliedAt: string | null;
    /** Applied by Answer and close in this database, so its changes can be undone (#58, ADR 0046). */
    undoable?: boolean;
}

/**
 * What Answer and close would do with one accepted claim (#58, ADR 0046):
 * - `fill`: put its date or place on an empty birth or death (and, when ticked, replace what differs);
 * - `event`: add it to the person as a new event;
 * - `cite`: the tree already says it, so cite the record on that fact;
 * - `in_tree`: already said and cited, nothing to do;
 * - `by_hand`: a marriage, parents, free text or someone not in the tree, left to enter by hand.
 */
export type CaseChangeKind = 'fill' | 'event' | 'cite' | 'in_tree' | 'by_hand';

export interface CaseChange {
    claimId: number;
    findingId: number;
    leadIds: number[];
    kind: CaseChangeKind;
    what: string;
    personId: number | null;
    /** The tree's name for the person, or the record's name for someone not in it. */
    personLabel: string | null;
    says: string | null;
    date: string | null;
    place: string | null;
    /** `fill`: which of the claim's fields go into empty ones. */
    fills: { date: boolean; place: boolean };
    /** `fill`: what the tree says where the claim says otherwise; replaced only when ticked. */
    differs: { date: string | null; place: string | null };
    sourceTitle: string | null;
}

export type CaseSourceNature = 'original' | 'derivative' | 'authored';
export type CaseInformation = 'primary' | 'secondary' | 'unknown';

/** A record a lead turned up, or a search that turned up nothing (#58). */
export interface CaseFinding {
    Id: number;
    CaseId: number;
    Kind: 'record' | 'nothing';
    UserId: number | null;
    CreatedAt: string;
    MediaId: number | null;
    media?: Media | null;
    SourceNature: CaseSourceNature | null;
    Information: CaseInformation | null;
    /** Nothing found: what was searched, where, and a note. */
    Searched: string | null;
    Site: string | null;
    Note: string | null;
    RequestId: number | null;
    /** The record's source citation (FactTable 'CaseFindings'); null for nothing found. */
    citation: {
        Id: number;
        SourceId: number;
        sourceTitle: string;
        sourceRepo: string | null;
        Page: string | null;
        Url: string | null;
        DataText: string | null;
    } | null;
    leadIds: number[];
    claims: CaseClaim[];
}

export type CaseRequestState = 'waiting' | 'received' | 'nothing';
export type CaseRequestSentBy = 'online' | 'email' | 'post' | 'in_person';

/** A record asked of an archive, a parish or a relative (#58). Heirloom sends nothing. */
export interface CaseRequest {
    Id: number;
    CaseId: number;
    LeadId: number | null;
    AskedFor: string;
    Holder: string | null;
    SentBy: CaseRequestSentBy | null;
    SentOn: string | null;
    Reference: string | null;
    RemindOn: string | null;
    State: CaseRequestState;
    RepliedAt: string | null;
    ReplyNote: string | null;
    CreatedAt: string;
}

/** Everything the desktop workspace reads beyond the case itself (#58). */
export interface CaseWorkspace {
    leads: CaseLead[];
    findings: CaseFinding[];
    requests: CaseRequest[];
}

export interface CaseWithRelations extends Case {
    people: {
        Id: number;
        FirstName: string | null;
        LastName: string | null;
        EffectiveFirstName?: string | null;
        Nickname?: string | null;
        Sex: string | null;
        PrimaryMediaId?: number;
        FocalX?: number;
        FocalY?: number;
        FocalRadius?: number | null;
    }[];
    media: Media[];
    citations: CaseCitation[];
    comments: CaseComment[];
    latestComment?: CaseComment | null;
}

export type AuditEntityType =
    | 'person' | 'family' | 'event' | 'media' | 'story' | 'case'
    | 'source' | 'citation' | 'mediatag' | 'namevariant'
    | 'import' | 'place' | 'familychild' | 'datacheck' | 'note' | 'casenote';

export interface AuditLogEntry {
    TreeId?: number | null;
    Id: number;
    TreeOwnerId: number;
    UserId: number;
    Action: 'create' | 'update' | 'delete';
    EntityType: AuditEntityType;
    EntityId: number;
    EntityLabel: string | null;
    Changes: AuditFieldChanges | AuditSnapshotChanges;
    CreatedAt: string;
}

export interface AuditFieldChanges {
    fields: Record<string, { old: unknown; new: unknown }>;
    /** familychild and note updates only: the link or note the change belongs to (#788, #796, #1045). */
    snapshot?: Record<string, unknown>;
    /**
     * Person, family and event updates from v64 on (ADR 0037): the place each changed
     * place field pointed at, by the field ("BirthPlace"), so undo restores that
     * place and not whichever place its name means now.
     */
    places?: Record<string, { old: AuditPlaceRef; new: AuditPlaceRef }>;
}

/** A fact's place references as an audit entry keeps them. */
interface AuditPlaceRef {
    id: number | null;
    nameId: number | null;
}

export interface AuditSnapshotChanges {
    snapshot: Record<string, unknown>;
    /** Person deletes: the cascaded and linked rows a revert restores (#788). */
    dependents?: Record<string, Record<string, unknown>[]>;
}

export type NewAuditLogEntry = Omit<AuditLogEntry, 'Id' | 'CreatedAt'>;

export interface AuditLogEntryWithUser extends AuditLogEntry {
    UserName: string | null;
    UserEmail: string | null;
}

// Helper types for creating new records (without Id and UpdatedAt which are auto-managed)
export type NewUser = Omit<User, 'Id' | 'CreatedAt' | 'UpdatedAt'>;
// Per-tree sharing: creating a share REQUIRES the tree being shared.
export type NewTreeSharing = Omit<TreeSharing, 'Id' | 'CreatedAt' | 'TreeId'> & { TreeId: number };
export type NewPerson = Omit<Person, 'Id' | 'UpdatedAt'>;
export type NewFamily = Omit<Family, 'Id' | 'UpdatedAt'>;
export type NewGedcomEvent = Omit<GedcomEvent, 'Id'>;
export type NewMedia = Omit<Media, 'Id'>;
// NewSource lives in lib/db/queries/sources.ts (see note above)

// Extended types with relationships
/**
 * A child as a family lists them, with their link to each partner
 * (`FamilyPerson."Partner1Relationship"` / `"Partner2Relationship"`, a
 * `ChildRelationshipType`, #982). The person page reads it to tag a child
 * "stepson" or a sibling "half-sibling" (#49). Never inferred.
 */
export type LinkedChild = Person & {
    Partner1Relationship?: string | null;
    Partner2Relationship?: string | null;
};

export interface SpouseRelation {
    person: Person | null;
    family: Family;
    children: LinkedChild[];
}

export interface ParentRelation {
    father: Person | null;
    mother: Person | null;
    family: Family;
    /**
     * How THIS person is linked to each parent: `FamilyPerson."Partner1Relationship"`
     * (the father slot) and `"Partner2Relationship"` (the mother slot), each a
     * `ChildRelationshipType` (#982). A person with more than one parent family
     * needs them: the UI names an adoptive, foster or step family as such instead
     * of rendering a second, identical "Parents" block (#481). Never inferred.
     */
    partner1Relationship?: string | null;
    partner2Relationship?: string | null;
    /** The family's OTHER children — this person's siblings through this family. */
    siblings: LinkedChild[];
}

export interface PersonWithRelations extends PersonDisplay {
    familiesAsSpouse?: Family[];
    familiesAsChild?: Family[];
    events?: EventWithMedia[];
    media?: Media[];
    // Enhanced resolved relationship data
    spouses?: SpouseRelation[];
    parents?: ParentRelation[];
    siblings?: Person[];
}

export interface FamilyWithRelations extends Family {
    husband?: Person | null;
    wife?: Person | null;
    /** Each child carries its link: the relationship to each partner (#982) and the FAMC / CHIL passthrough (#954, #961). */
    children?: (Person & { Partner1Relationship?: string; Partner2Relationship?: string; FamcRawGedcom?: string | null; ChilRawGedcom?: string | null })[];
    /** Family-level events (Events with FamilyId) — for GEDCOM export. */
    events?: GedcomEvent[];
}

// Event type mapping (from C# GedcomEvent.EventTypes)
export const EVENT_TYPES: Record<string, string> = {
    'BIRT': 'Birth',
    'DEAT': 'Death',
    'OCCU': 'Occupation',
    'EDUC': 'Education',
    'RESI': 'Residence',
    'BURI': 'Burial',
    'CHR': 'Christening',
    'BAPM': 'Baptism',
    'ADOP': 'Adoption',
    'EVEN': 'Event',
    'GRAD': 'Graduation',
    'EMIG': 'Emigration',
    'IMMI': 'Immigration',
    'NATU': 'Naturalization',
    'CENS': 'Census',
    'RETI': 'Retirement',
    'PROB': 'Probate',
    'WILL': 'Will',
};

export function getEventDisplayType(type: string): string {
    return EVENT_TYPES[type] || type;
}
