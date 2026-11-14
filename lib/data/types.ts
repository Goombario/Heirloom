import type { PlaceKey } from '@/lib/places/place-key';
import type { PersonWithParentFamily } from '@/lib/db/queries/people';
import type { NextStep } from '@/lib/db/queries/home';
import type { Person, PersonWithRelations, Family, FamilyWithRelations, GedcomEvent, EventWithMedia, Media, MediaWithPerson, MediaLinkOwner, MediaTag, MediaTagWithPerson, PersonGalleryMedia, OwnerGalleryMedia, AuditLogEntryWithUser, Case, CaseComment, CaseWithRelations, Tree, MediaImportItem, MediaImportFailureCode } from '@/lib/db/schema';
import type { FamilyWithSpouseNames } from '@/lib/db/queries/families';
import type { ChildRelationshipType, ChildRelationshipInput } from '@/lib/child-relationship';
import type { scoreSuggestions } from '@/lib/family-suggestions';
import type { TreeData } from '@/app/components/tree/types';
import type { Source } from '@/lib/db/queries/sources';
import type { Citation, CitedByRow } from '@/lib/db/queries/citations';
import type { Note, NoteLinkEnd, NoteOwnerFact } from '@/lib/db/queries/notes';
import type { PlaceUses } from '@/lib/db/queries/places';
import type { Repository, RepositoryWithCount } from '@/lib/db/queries/repositories';
import type { FactTableValue, LinkOwnerTable, MediaOwnerFact, MediaOwnerTable } from '@/lib/db/fact-tables';
import type { Audited } from '@/lib/db/queries/audit-capture';

export type { Audited };
import type { CaseNoteStrike } from '@/lib/db/queries/cases';
export type { CaseNoteStrike };
import type { DataCheckInput, DataCheckProblem } from '@/lib/data-checks/rules';
import type { DataCheckPersonName } from '@/lib/db/queries/data-checks';
import type { GedcomImportStep } from '@/lib/gedcom/import-steps';
import type { ActivityRow } from '@/lib/utils/activity-groups';
import type { PinChainRow } from '@/lib/services/places';
import type { FaceConfirmBatchResult, FaceGroup } from '@/lib/services/media-faces';
import type { FaceDismissReason } from '@/lib/db/schema';
import type { CaseChange, CaseClaimDecision, CaseClaimEvidence, CaseInformation, CaseOutcome, CaseRequestSentBy, CaseRequestState, CaseSourceNature, CaseWorkspace } from '@/lib/db/schema';
import type { FaceSuggestionSnapshot } from '@/lib/db/queries/media-faces';
import type { MediaDeleteBatchResult } from '@/lib/services/media';
import type { PeopleFlag } from '@/lib/db/queries/data-quality';
export type { MediaDeleteBatchResult } from '@/lib/services/media';
export type { MediaImportItem } from '@/lib/db/schema';
export type { FaceConfirmBatchResult, FaceGroup };

export interface GetPeopleOptions {
  /** Tree scope id; omit/null for the current user's default tree. */
  treeId?: number | null;
  /** Optional name search. */
  search?: string | null;
}

export interface GetPeopleResult {
  people: PersonWithParentFamily[];
  count: number;
}

/** Fields accepted when creating a person (all optional except the name rule). */
export interface CreatePersonInput {
  FirstName?: string | null;
  LastName?: string | null;
  Sex?: string | null;
  GedcomId?: string | null;
  BirthDate?: string | null;
  BirthPlace?: string | null;
  /** The place picked for `BirthPlace`, by id (#1186): two places may share a name. */
  BirthPlaceId?: number | null;
  DeathDate?: string | null;
  DeathPlace?: string | null;
  /** The place picked for `DeathPlace`, by id (#1186). */
  DeathPlaceId?: number | null;
  DeathCause?: string | null;
  IsDeceased?: number | null;
  // No `Notes`: dropped in #524 (ADR 0010). A person's notes are created
  // separately through `client.notes.create('People', id, …)`.
}

/** Partial update for a person — same fields as create, all optional. */
export type UpdatePersonInput = CreatePersonInput;

/** A row of the `NameVariant` table as returned by the API. */
export interface NameVariant {
  Id: number;
  PersonId: number;
  Type: string;
  Name: string;
  FromDate: string | null;
  ToDate: string | null;
  /** 0/1 — the DB stores this INTEGER column (see lib/db/queries/name-variants.ts).
   *  Consumers use truthiness; never compare `=== true`. */
  IsPrimary: number;
}

/** A name variant's "dates used" range (#898); null clears that end. */
export interface NameVariantDates {
  FromDate: string | null;
  ToDate: string | null;
}

export interface CreateNameVariantInput {
  Type?: string;
  Name: string;
  FromDate?: string | null;
  ToDate?: string | null;
}

export interface SuggestFamilyParams {
  lastName: string;
  birthDate: string;
  sex?: string;
  birthPlace?: string;
  treeId?: number | null;
}

/** Element type of the suggestions array the API returns. */
export type FamilySuggestion = ReturnType<typeof scoreSuggestions>[number];

export interface RelationshipResult {
  path: Array<{ id: number; name: string; relationship: string }>;
  relationship: string;
  degree: number;
}

/** One sampled person's face for a place's card/table face-stack — a photo
 *  thumbnail when available (via ProfileImage + primaryMediaId/focal*), else
 *  the caller falls back to initials. */
export interface PlaceFace {
  id: number;
  firstName: string | null;
  lastName: string | null;
  effectiveFirstName: string | null;
  nickname: string | null;
  sex: string | null;
  primaryMediaId: number | null;
  focalX: number | null;
  focalY: number | null;
  focalRadius: number | null;
}

export interface PlaceSummary {
  name: string;
  count: number;
  latitude?: number | null;
  longitude?: number | null;
  displayName?: string | null;
  /** Gazetteer Places.Id for this place string (null if no backfilled row). */
  id: number | null;
  /** Self-link to the parent jurisdiction's Places.Id. */
  parentId: number | null;
  /** The place's other names (#1167), when it has any. */
  otherNames?: string[];
  /** Distinct people linked to this place (unlike `count`, which is raw fact occurrences). */
  peopleCount: number;
  /** Up to 4 sampled people for a face-stack indicator, sorted by id (deterministic). */
  faces: PlaceFace[];
}

/** Flat gazetteer row — the skeleton the hierarchy util walks (incl. 0-fact parents). */
export interface PlaceGazetteerNode {
  id: number;
  name: string;
  parentId: number | null;
  latitude: number | null;
  longitude: number | null;
  displayName: string | null;
  pinSuppressed: boolean;
  /** The place's other names (#1167), when it has any. */
  otherNames?: string[];
}

/** A person born and/or died at a place (place-detail rail row). */
export interface PlacePersonEntry {
  Id: number;
  FirstName: string | null;
  LastName: string | null;
  EffectiveFirstName: string | null;
  Nickname: string | null;
  Sex: string | null;
  BirthDate: string | null;
  DeathDate: string | null;
  PrimaryMediaId: number | null;
  /** Focal crop of the primary photo (percent coords), so the row's avatar
   *  shows the face rather than a centred crop of the whole photo. Null when
   *  the photo carries no crop. */
  FocalX: number | null;
  FocalY: number | null;
  FocalRadius: number | null;
  /** 'born' | 'died' | 'born & died' — derived in the query. */
  PlaceRole: string;
}

/** Count of events of one GEDCOM type at a place (the detail rail only needs
 *  tallies, not full event rows — audit #10). */
interface PlaceEventTypeCount {
  type: string;
  count: number;
}

/** A place id/name pair used for breadcrumb ancestors and child links. */
interface PlaceRef {
  id: number;
  name: string;
}

/** One person's link to a place, by the single fact that ties them to it.
 *  Mirrors PlaceFactLink in lib/db/queries/places.ts. */
export interface PlaceFactLinkEntry {
  personId: number;
  name: string;
  sex: string | null;
  primaryMediaId: number | null;
  /** Focal crop of the primary photo (percent coords); null when the photo has
   *  none, which `ProfileImage` reads as "object-cover, centred". */
  focalX: number | null;
  focalY: number | null;
  focalRadius: number | null;
  kind: 'birth' | 'death' | 'marriage' | 'event';
  /** GEDCOM type code for kind==='event' (RESI, OCCU, ...); null otherwise. */
  eventType: string | null;
  date: string | null;
  /** The place string this fact actually carries — a descendant place when a
   *  jurisdiction rolled the fact up, so the row can name the sub-place. */
  placeName: string;
  /** The record holding the fact: the person, the family or the event (#1186). */
  recordId: number;
  /** The place the fact points at: the page's own place, or one below it. */
  placeId: number;
}

export interface PlaceDetail {
  name: string;
  people: PlacePersonEntry[];
  /** Every fact naming this place, one row each, with its reason. A person tied
   *  by several facts appears several times. Always present — the detail service
   *  builds it alongside `people`, so consumers need no fallback. */
  factLinks: PlaceFactLinkEntry[];
  /** Events at this place tallied by GEDCOM type (marriages are counted separately). */
  eventCounts: PlaceEventTypeCount[];
  /** Total number of events at this place. */
  eventCount: number;
  /** Number of families married at this place. */
  familyCount: number;
  latitude?: number | null;
  longitude?: number | null;
  displayName?: string | null;
  /** The machine-readable half of the geocoder provenance that `displayName` names
   *  (ADR 0017). Read-only to the UI, but the edit form must send them back on save:
   *  the single-row upsert assigns them unconditionally, so omitting them nulls a
   *  match the row already had. */
  osmType?: string | null;
  osmId?: number | null;
  /** Gazetteer row id (present when the place is a `Places` record) — enables notes. */
  id?: number | null;
  /** The geocoded places below this one, when it has no own coordinates (#923). */
  descendantPins?: {
    id: number;
    name: string;
    lat: number;
    lng: number;
  }[];
  /** Nearest ancestor pin when this place has no own coordinates and no geocoded
   *  descendants. */
  inheritedFrom?: {
    id: number;
    name: string;
    lat: number;
    lng: number;
  } | null;
  /** GEDCOM PLAC.FORM jurisdiction template, if recorded. */
  form?: string | null;
  /** What kind of place it is ("City", "County"), from its own or a descendant's FORM (#45). */
  kind?: string | null;
  /** What the geocoder matched, as OSM's `key/value` (#45, ADR 0050); shown when `kind` is not. */
  osmKind?: string | null;
  /** Jurisdiction ancestors, root-first (breadcrumb). */
  parents?: PlaceRef[];
  /** Direct child places in the hierarchy, with the events and marriages recorded in each (itself and below). */
  children?: (PlaceRef & { records?: number })[];
  /** The place's other names (#1185), each with how many records were written under it. */
  otherNames?: PlaceOtherName[];
  /** What still uses the place itself (#1229); a place can be deleted only when all are 0. */
  uses?: PlaceUses | null;
  /** How many of its records say the place's own name. */
  ownNameRecords?: number;
}

/** Another name of a place (#1185): Lemberg, German, until 1918. */
export interface PlaceOtherName {
  id: number;
  name: string;
  language: string | null;
  fromDate: string | null;
  toDate: string | null;
  /** Records written under this name. */
  records: number;
}

/** A place's other name as the editor saves it: `id` for one it has, none for a new one. */
export interface PlaceOtherNameDraft {
  id?: number | null;
  name: string;
  language: string | null;
  fromDate: string | null;
  toDate: string | null;
}

export interface ResolvedPlace {
  name: string;
  /** The place's id when the caller has it (#1186); `name` is then only a label. */
  placeId?: number | null;
  /** Null = suppressing the pin (see pinSuppressed) or clearing coordinates. */
  latitude: number | null;
  longitude: number | null;
  displayName?: string | null;
  osmType?: string | null;
  osmId?: number | null;
  /** Explicit "no pin, ever" — distinct from "not resolved yet" (also null coords,
   *  but this flag false). See docs/superpowers/specs/2026-07-09-places-precision-hierarchy-design.md §3. */
  pinSuppressed?: boolean;
}

/** Map of place key (`placeKeyString`: a name, or `#<id>`) → coordinates. Only
 *  geocoded places (both coords present) appear. */
export type PlaceCoords = Record<string, { lat: number; lng: number }>;

export type { PinChainRow };

export interface PeopleClient {
  list(options?: GetPeopleOptions): Promise<GetPeopleResult>;
  create(input: CreatePersonInput, options?: { treeId?: number | null }): Promise<Audited<Person>>;
  get(id: number, treeId?: number | null): Promise<PersonWithRelations>;
  update(id: number, patch: UpdatePersonInput, treeId?: number | null): Promise<Audited<Person>>;
  remove(id: number, treeId?: number | null): Promise<void>;
  /** `places` also matches the birthplace (global search, #1128). */
  search(q: string, treeId?: number | null, limit?: number, options?: { places?: boolean }): Promise<PersonWithParentFamily[]>;
  /** The people behind a home suggestion, as groups of likely matches in review order (#794, #822). */
  listFlagged(flag: PeopleFlag, treeId?: number | null): Promise<number[][]>;
  listNameVariants(personId: number, treeId?: number | null): Promise<NameVariant[]>;
  createNameVariant(personId: number, body: CreateNameVariantInput, treeId?: number | null): Promise<Audited<NameVariant>>;
  setPrimaryNameVariant(personId: number, variantId: number, isPrimary: boolean, treeId?: number | null): Promise<Audited<NameVariant>>;
  /** `dates` (#898) sets the "dates used" range; omitted leaves it as stored. */
  /** `dates` may also carry a new `Type` (#1052); omitted keeps the stored one. */
  updateNameVariant(personId: number, variantId: number, name: string, treeId?: number | null, dates?: NameVariantDates & { Type?: string }): Promise<Audited<NameVariant>>;
  removeNameVariant(personId: number, variantId: number, treeId?: number | null): Promise<Audited>;
  suggestFamily(params: SuggestFamilyParams): Promise<FamilySuggestion[]>;
  /** Total descendants, all generations. Named for the cache-invalidation READ
   *  allowlist (see READ_EXACT in lib/data/cache-invalidation.ts). */
  descendantCount(personId: number, treeId?: number | null): Promise<number>;
}

export interface RelationshipClient {
  get(person1Id: number, person2Id: number, treeId?: number | null): Promise<RelationshipResult>;
}

export interface PlacesClient {
  list(treeId?: number | null): Promise<{ places: PlaceSummary[]; count: number; gazetteer: PlaceGazetteerNode[] }>;
  /** A place's page data, by id (#1186) or by a name it is called. */
  detail(place: PlaceKey, treeId?: number | null): Promise<PlaceDetail>;
  /** Batch lookup of coordinates for a set of places (map pins), keyed by
   *  `placeKeyString`. One request/query. */
  coords(places: PlaceKey[], treeId?: number | null): Promise<PlaceCoords>;
  /** Batch lookup of each place's raw ParentId chain (root → leaf) for pin
   *  resolution, keyed by `placeKeyString`. */
  pinChains(places: PlaceKey[], treeId?: number | null): Promise<Record<string, PinChainRow[]>>;
  geocodeUpsert(place: ResolvedPlace, treeId?: number | null): Promise<void>;
  /** Returns the audit entry, for Undo (#56). */
  updateCoordinates(place: PlaceKey, latitude: number, longitude: number, treeId?: number | null): Promise<Audited>;
  /** Persist a resolved jurisdiction chain (hierarchy rollup) in one call; `leafId`
   *  lands the last level on that place. */
  geocodeUpsertHierarchy(levels: { name: string; latitude?: number | null; longitude?: number | null; displayName?: string | null; osmType?: 'node' | 'way' | 'relation' | null; osmId?: number | null; osmKind?: string | null }[], treeId?: number | null, options?: { reparent?: boolean; leafId?: number | null }): Promise<Audited>;
  /** How many other places currently inherit their pin from this one. */
  dependentCount(place: PlaceKey, treeId?: number | null): Promise<number>;
  /** Rename a place, or merge it into an existing one (rewrites fact columns + gazetteer). */
  /** Undo reverts the one audit entry it returns (a merge included). */
  /** `keepOldName` keeps the old name as another name; `separate` renames onto another
   *  place's name without merging (#1185). */
  rename(from: PlaceKey, to: string, treeId?: number | null, options?: PlaceRenameOptions): Promise<Audited<{ renamed: number; wasMerge: boolean; to: string }>>;
  /** Replace a place's other names with `names` (#1185). Undo reverts the one audit
   *  entry it returns; an unchanged list returns none. */
  saveOtherNames(placeId: number, names: PlaceOtherNameDraft[], treeId?: number | null): Promise<Audited<{ added: number; changed: number; removed: number }>>;
  /** Point facts of place `fromId` at place `toId` (#1186): all of them, or only
   *  `records`. Undo reverts the one audit entry it returns. */
  moveRecords(fromId: number, toId: number, records?: PlaceMovedRecord[], treeId?: number | null): Promise<Audited<{ moved: number }>>;
  /** Delete a place nothing uses (#1229). Undo reverts the one audit entry it returns. */
  remove(placeId: number, treeId?: number | null): Promise<Audited<{ deleted: true }>>;
}

/** How a rename treats the old name and a place that has the new one (#1185). */
export interface PlaceRenameOptions {
  keepOldName?: boolean;
  separate?: boolean;
}

/** One fact to move to another place: a person's birth or death, a family's
 *  marriage, or an event, by its record's id. */
export interface PlaceMovedRecord {
  kind: 'birth' | 'death' | 'marriage' | 'event';
  recordId: number;
}

/** Fields accepted when creating/updating a family (all optional). */
export interface FamilyInput {
  Partner1Id?: number | null;
  Partner2Id?: number | null;
  HusbandId?: number | null;
  WifeId?: number | null;
  MarriageDate?: string | null;
  MarriagePlace?: string | null;
  /** The place picked for `MarriagePlace`, by id (#1186). */
  MarriagePlaceId?: number | null;
  Type?: string | null;
}

/** The flat shape returned by GET /api/families/{id}. */
export interface FamilyDetail {
  family: Pick<Family, 'Id' | 'Partner1Id' | 'Partner2Id' | 'MarriageDate' | 'MarriagePlace' | 'MarriagePlaceId' | 'Type'>;
  husband: FamilyWithRelations['husband'];
  wife: FamilyWithRelations['wife'];
  children: FamilyWithRelations['children'];
  /** Family-level events (Events with FamilyId) — divorce/annulment/engagement/… with attached media. */
  events: EventWithMedia[];
  /** The marriage's own photos (MediaLink scoped to Marriage, ADR 0030), for its timeline row. */
  marriageMedia?: Media[];
  /** The children's adoption events (`ADOP` on the child), for the family timeline (#485). */
  childAdoptions?: GedcomEvent[];
  /** The family photo (#119, ADR 0047); the cover shows the partners' split portrait without one. */
  photo?: Media | null;
}

export type { ChildRelationshipType, ChildRelationshipInput };

/** A destructive change's audit entry, so the UI can offer Undo through the audit revert (#788). */
export interface AuditedChange {
  auditId: number | null;
}

export interface FamiliesClient {
  list(treeId?: number | null): Promise<{ families: FamilyWithSpouseNames[]; count: number }>;
  create(input: FamilyInput, treeId?: number | null): Promise<Audited<Family>>;
  get(id: number, treeId?: number | null): Promise<FamilyDetail>;
  update(id: number, patch: FamilyInput, treeId?: number | null): Promise<Audited<Family>>;
  remove(id: number, treeId?: number | null): Promise<AuditedChange>;
  search(q: string, treeId?: number | null): Promise<FamilyWithSpouseNames[]>;
  /** `relationship` is one type for both partners, or one per partner (#982). */
  addChild(familyId: number, childId: number, relationship?: ChildRelationshipInput, treeId?: number | null): Promise<Audited>;
  updateChildType(familyId: number, childId: number, relationship: ChildRelationshipInput, treeId?: number | null): Promise<Audited>;
  removeChild(familyId: number, childId: number, treeId?: number | null): Promise<AuditedChange>;
  /** Move a child from `familyId` to `toFamilyId` as one audited, revertible change (#796). */
  moveChild(familyId: number, childId: number, toFamilyId: number, treeId?: number | null): Promise<AuditedChange>;
}

/** Fields accepted when creating an event. Type is required; the rest are optional. */
export interface EventInput {
  Type: string;
  Date?: string | null;
  Place?: string | null;
  /** The place picked for `Place`, by id (#1186): two places may share a name. */
  PlaceId?: number | null;
  Description?: string | null;
  PersonId?: number | null;
  FamilyId?: number | null;
}

export interface EventsClient {
  create(input: EventInput, treeId?: number | null): Promise<Audited<GedcomEvent>>;
  /** Update a custom event's fields. */
  update(id: number, patch: Partial<EventInput>, treeId?: number | null): Promise<Audited<GedcomEvent>>;
  /** Delete a custom event. */
  remove(id: number, treeId?: number | null): Promise<Audited>;
}

export interface TreeGetParams {
  /** Root person id; omit/null to let the server pick a default root. */
  id?: number | null;
  /** 'descendants' | 'ancestors' | 'focus' (server defaults to 'descendants'). */
  mode: string;
  treeId?: number | null;
}

/**
 * Per-table record counts for a tree — one field per table a GEDCOM `overwrite`
 * import deletes. Keep in lockstep with the overwrite DELETE block in
 * `lib/services/gedcom.ts`; see `getTreeCountsService`.
 */
export interface TreeCounts {
  people: number;
  families: number;
  events: number;
  media: number;
  cases: number;
  places: number;
  sources: number;
  repositories: number;
  notes: number;
  citations: number;
  /** Confirmed unlikely data checks (#830). */
  dataCheckConfirmations: number;
}

export interface TreeClient {
  get(params: TreeGetParams): Promise<TreeData>;
  /** Record counts for the tree, used to gate the destructive overwrite import. */
  getCounts(treeId?: number | null): Promise<TreeCounts>;
}

export interface ListMediaOptions {
  treeId?: number | null;
  /** Filter to a single person's media. */
  personId?: number;
  /** Include the joined person name fields (library view). */
  withPerson?: boolean;
  /** Include tag data + tagged-in media for the person (person gallery). */
  includeTagged?: boolean;
}

/** Multipart upload input; `HttpMediaClient` builds the FormData. */
export interface UploadMediaInput {
  file: File;
  /** Stable replay key retained by a staged event-media draft. */
  uploadIntentId?: string;
  personId?: number;
  title?: string;
  isPrimary?: boolean;
  caseId?: number;
  /** Attach the new media to an owner record via MediaLink (family/source/…). */
  ownerTable?: MediaOwnerTable;
  ownerRecordId?: number;
  /** Scope that link to one of the owner's vital facts (ADR 0030). */
  ownerFact?: MediaOwnerFact;
}

/**
 * One photo in an upload batch that the tree already holds (#592).
 *
 * `reason` is a single-member union rather than a boolean deliberately: a
 * boolean would have to be widened when a second verdict appears, and a union
 * will not. (Batch-internal duplicates never reach this type — they are decided
 * client-side without a round trip.)
 */
export interface DuplicateMatch {
  hash: string;
  mediaId: number;
  title: string | null;
  reason: 'in-tree';
}

/** Partial update for a media record (only the fields callers actually send). */
export interface UpdateMediaInput {
  Title?: string | null;
  /** When the photo was taken, as a genealogical date (#802). */
  Date?: string | null;
  FocalX?: number | null;
  FocalY?: number | null;
  FocalRadius?: number | null;
}

export interface MediaStorageSummary {
  usedBytes: number;
  limitBytes: number | null;
  remainingBytes: number | null;
  percentUsed: number | null;
  quotaMode: 'tree' | 'device';
}

export interface CreateMediaTagInput {
  PersonId: number;
  RegionX: number;
  RegionY: number;
  RegionW: number;
  RegionH: number;
}

/** Coordinate-only redraw of an existing face tag. */
export type UpdateMediaTagInput = Pick<CreateMediaTagInput, 'RegionX' | 'RegionY' | 'RegionW' | 'RegionH'>;

export interface MediaClient {
  /** Lists media. Pass a narrower `T` when a variant returns a richer row shape. */
  list<T extends Media = Media>(options?: ListMediaOptions): Promise<{ media: T[]; count: number }>;
  /** Returns authoritative hosted quota data or device-managed storage usage. */
  getStorageSummary(treeId?: number | null): Promise<MediaStorageSummary>;
  /**
   * Media attached to an owner record (family / source / …) via MediaLink. With
   * `ownerFact`, the media linked to that vital fact instead (ADR 0030), as for
   * every owner call below.
   */
  listForOwner(ownerTable: MediaOwnerTable, ownerId: number, treeId?: number | null, ownerFact?: MediaOwnerFact): Promise<Media[]>;
  /** Owner gallery: explicit links plus qualifying family-member tag inference; every fact link too, labelled. */
  listGalleryForOwner(ownerTable: MediaOwnerTable, ownerId: number, treeId?: number | null, ownerFact?: MediaOwnerFact): Promise<OwnerGalleryMedia[]>;
  /** Detach media from an owner (unlink-only — the Media row persists in the library). */
  unlinkFromOwner(id: number, ownerTable: MediaOwnerTable, ownerId: number, treeId?: number | null, ownerFact?: MediaOwnerFact): Promise<void>;
  /** Attach an EXISTING media row to an owner record (family/source/event/…) via MediaLink. */
  linkToOwner(mediaId: number, ownerTable: MediaOwnerTable, ownerId: number, treeId?: number | null, ownerFact?: MediaOwnerFact): Promise<void>;
  /** Every record one media row is linked to, named for the viewer's "Linked to" (#510). */
  listLinkOwners(mediaId: number, treeId?: number | null): Promise<MediaLinkOwner[]>;
  upload(input: UploadMediaInput, treeId?: number | null): Promise<Media>;
  /**
   * Which of these content hashes the tree already holds (#592). Advisory: the
   * caller decides what to do with the answer, and nothing reachable from here
   * can prevent an upload the user has chosen.
   */
  findDuplicates(hashes: string[], treeId?: number | null): Promise<DuplicateMatch[]>;
  update(id: number, patch: UpdateMediaInput, treeId?: number | null): Promise<Audited<Media>>;
  /** Set this media as one person's canonical primary image. */
  setPrimary(mediaId: number, personId: number, treeId?: number | null): Promise<Audited>;
  /** Stop using this photo as the person's portrait; it stays in their media. A no-op once another photo is. */
  clearPrimary(mediaId: number, personId: number, treeId?: number | null): Promise<Audited>;
  /** Use this photo as the family's photo (#119); a photo shown only through tags gains a family link. */
  setFamilyPhoto(mediaId: number, familyId: number, treeId?: number | null): Promise<Audited>;
  /** Stop using this photo as the family's photo; it stays with the family. A no-op once another photo is. */
  clearFamilyPhoto(mediaId: number, familyId: number, treeId?: number | null): Promise<Audited>;
  remove(id: number, treeId?: number | null): Promise<void>;
  /** Best-effort deletion of independent media rows, preserving item order. */
  removeMany(ids: number[], treeId?: number | null): Promise<MediaDeleteBatchResult>;
  listTags(mediaId: number, treeId?: number | null): Promise<MediaTagWithPerson[]>;
  createTag(mediaId: number, input: CreateMediaTagInput, treeId?: number | null): Promise<Audited<MediaTag>>;
  updateTag(mediaId: number, tagId: number, input: UpdateMediaTagInput, treeId?: number | null): Promise<Audited<MediaTagWithPerson>>;
  removeTag(mediaId: number, tagId: number, treeId?: number | null): Promise<void>;
  /**
   * The unconfirmed-face queue, grouped by the name written in the photo (#487).
   * `countOnly` returns just `pendingTotal` (with `groups: []`) for the Library
   * tab badge, which would otherwise pull the entire candidate payload to render
   * one integer. `mediaId` keeps only that photo's candidates, for the photo
   * viewer, which otherwise read the whole tree's queue to show one photo's
   * boxes (#1268); the totals stay tree-wide.
   */
  listFaceQueue(options?: { resolved?: boolean; countOnly?: boolean; mediaId?: number }, treeId?: number | null): Promise<{ groups: FaceGroup[]; pendingTotal: number; resolvedTotal: number }>;
  confirmFaces(candidateIds: number[], personId: number, treeId?: number | null): Promise<FaceConfirmBatchResult>;
  /**
   * Points candidates at a person the user chose and leaves them PENDING (#487,
   * spec §5). Nothing reaches `MediaTag` — that still takes an explicit Confirm.
   */
  repointFaces(candidateIds: number[], personId: number, treeId?: number | null): Promise<{ repointed: number; personName: string | null; previous: FaceSuggestionSnapshot[] }>;
  /**
   * Undo for a re-point. Re-pointing overwrites the suggestion in place, so
   * unlike confirm/dismiss there is no status transition to walk back —
   * `repointFaces` hands back the prior values and this puts them.
   */
  restoreFaceSuggestions(previous: FaceSuggestionSnapshot[], treeId?: number | null): Promise<{ restored: number }>;
  dismissFaces(candidateIds: number[], reason: FaceDismissReason, treeId?: number | null): Promise<{ dismissed: number }>;
  undoFaces(candidateIds: number[], treeId?: number | null): Promise<{ restored: number; skipped: number }>;
  /**
   * Reads raw image bytes for blob-URL rendering in the local build. Http never
   * calls this (it uses the /api/media/{id}/file URL); the local client reads
   * MediaBlob. Returns the original (already compressed at upload).
   */
  getFile(id: number, treeId?: number | null): Promise<{ bytes: Uint8Array; contentType: string }>;
  /**
   * Local-only: a ~256px thumbnail (lazy-generated + cached in MediaThumb). Http
   * never calls this — its `useMediaUrl` branch returns a `?w=` URL synchronously
   * and never reads bytes.
   */
  getThumb(id: number, treeId?: number | null): Promise<{ bytes: Uint8Array; contentType: string }>;
}

// MediaWithPerson and PersonGalleryMedia are used by the call-site migration (later task).
export type { MediaWithPerson, PersonGalleryMedia };

export interface CreateSourceInput {
  Title: string;
  Author?: string | null;
  PublicationInfo?: string | null;
  RepositoryName?: string | null;
  CallNumber?: string | null;
  Text?: string | null;
  Type?: string | null;
  Contents?: string | null;
}
export type UpdateSourceInput = Partial<CreateSourceInput>;

export interface SourcesClient {
  list<T extends Source = Source>(options?: { treeId?: number | null; withCounts?: boolean }): Promise<{ sources: T[]; count: number }>;
  search(q: string, treeId?: number | null): Promise<Source[]>;
  get(id: number, treeId?: number | null): Promise<Source>;
  create(input: CreateSourceInput, treeId?: number | null): Promise<Source>;
  update(id: number, patch: UpdateSourceInput, treeId?: number | null): Promise<Source>;
  remove(id: number, treeId?: number | null): Promise<void>;
  citedBy(id: number, treeId?: number | null): Promise<CitedByRow[]>;
  /** The sources this tree cited most recently, newest first (#799). */
  listRecentlyCited(treeId?: number | null): Promise<Source[]>;
}

export interface CreateCitationInput {
  FactTable: FactTableValue;
  FactId: number;
  SourceId: number;
  Page?: string | null;
  Note?: string | null;
  /** GEDCOM QUAY certainty, stored as '0'–'3' (3 = primary … 0 = unreliable). */
  Quay?: string | null;
  /** GEDCOM DATA.TEXT — a transcription of the relevant passage from the source. */
  DataText?: string | null;
  /** The link to the record this citation points at (ADR 0025). */
  Url?: string | null;
}

/**
 * One source cited on many facts in one write (#799). Page, Quay and DataText
 * are shared; a fact's own Page (a household member's line) overrides Page.
 */
export interface CreateCitationsInput {
  SourceId: number;
  Page?: string | null;
  Quay?: string | null;
  DataText?: string | null;
  facts: { FactTable: FactTableValue; FactId: number; Page?: string | null }[];
}

/** Editable citation fields (page / certainty / transcription / record link). An omitted Url keeps the stored one. */
export interface UpdateCitationInput {
  Page?: string | null;
  Quay?: string | null;
  DataText?: string | null;
  Url?: string | null;
}

export interface CitationsClient {
  /** Person citations, keyed `"FactTable:FactId"`. */
  listForPerson(personId: number, treeId?: number | null): Promise<Record<string, Citation[]>>;
  listForFamily(familyId: number, treeId?: number | null): Promise<Record<string, Citation[]>>;
  listForFact(factTable: FactTableValue, factId: number, treeId?: number | null): Promise<Citation[]>;
  create(input: CreateCitationInput, treeId?: number | null): Promise<Audited<Citation>>;
  /** Cite one source on many facts in a single transaction (#799). */
  createMany(input: CreateCitationsInput, treeId?: number | null): Promise<Citation[]>;
  update(id: number, patch: UpdateCitationInput, treeId?: number | null): Promise<Audited<Citation>>;
  remove(id: number, treeId?: number | null): Promise<Audited>;
}

/** Input for renaming / editing a repository (archive). */
export interface UpdateRepositoryInput {
  Name?: string;
  Address?: string | null;
  Website?: string | null;
  Phone?: string | null;
  Email?: string | null;
}

/** Input for creating a repository (archive). */
export interface CreateRepositoryInput {
  Name: string;
  Address?: string | null;
  Website?: string | null;
  Phone?: string | null;
  Email?: string | null;
}

/** Repositories (archives) that hold sources — one archive → many sources. */
export interface RepositoriesClient {
  list(treeId?: number | null): Promise<RepositoryWithCount[]>;
  get(id: number, treeId?: number | null): Promise<Repository>;
  sources(id: number, treeId?: number | null): Promise<{ Id: number; Title: string | null }[]>;
  create(input: CreateRepositoryInput, treeId?: number | null): Promise<Repository>;
  update(id: number, patch: UpdateRepositoryInput, treeId?: number | null): Promise<Repository>;
  remove(id: number, treeId?: number | null): Promise<void>;
}

/** Notes attached to an owner record (family / source / …) via NoteLink. */
export interface NotesClient {
  listForOwner(ownerTable: LinkOwnerTable, ownerId: number, treeId?: number | null): Promise<Note[]>;
  /** `ownerFact` scopes the note to a promoted vital fact (set from context; `move` changes it later, ADR 0043). */
  create(ownerTable: LinkOwnerTable, ownerId: number, text: string, treeId?: number | null, ownerFact?: NoteOwnerFact): Promise<Audited<Note>>;
  update(id: number, ownerTable: LinkOwnerTable, ownerId: number, text: string, treeId?: number | null): Promise<Audited<Note>>;
  remove(id: number, ownerTable: LinkOwnerTable, ownerId: number, treeId?: number | null): Promise<Audited>;
  /** Mark this note as the owner's primary, or clear the owner's primary (`false`). */
  setPrimary(id: number, ownerTable: LinkOwnerTable, ownerId: number, isPrimary: boolean, treeId?: number | null): Promise<Audited>;
  /** Move one link of a note to another record or fact it is about (ADR 0043). */
  move(id: number, from: NoteLinkEnd, to: NoteLinkEnd, treeId?: number | null): Promise<Audited>;
}

export interface AuditListOptions {
  treeId?: number | null;
  page?: number;
  pageSize?: number;
  entityType?: string;
  action?: string;
  who?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  sort?: string;
  dir?: string;
}
export interface AuditListResult {
  entries: AuditLogEntryWithUser[];
  total: number;
  page: number;
  pageSize: number;
  /** Names for the person and family ids in these entries' changes, keyed by id (#551). */
  refs: { people: Record<string, string>; families: Record<string, string> };
  /** The record each entry belongs to, keyed by entry id (#930). */
  records: Record<string, AuditRecord>;
}

/** What an audit entry's Record column names: the person, family, source, case or place it belongs to. */
export type AuditRecordKind = 'person' | 'family' | 'source' | 'case' | 'place' | 'media' | 'tree';

/**
 * The item inside the record that changed, shown under the record's name. Built
 * from ids and codes, so the page words it in the reader's language (#930).
 */
export type AuditRecordItem =
  | { kind: 'event'; code: string | null }
  /** `fact` is a citation fact key (`birth`, `partnership`…); a cited event carries its code. */
  | { kind: 'citation'; fact: string | null; eventCode: string | null; source: string | null }
  | { kind: 'photoTag'; photo: string | null }
  | { kind: 'profilePicture'; photo: string | null }
  | { kind: 'familyPhoto'; photo: string | null }
  /** The child a child link names; `live` while they are still in the tree. */
  | { kind: 'child'; id: number | null; name: string | null; live: boolean }
  | { kind: 'nameVariant'; type: string | null; name: string | null }
  | { kind: 'note' }
  /** A case journal entry (#1227); its record is the case. */
  | { kind: 'journalEntry' }
  | { kind: 'story'; title: string | null }
  | { kind: 'dataCheck'; rule: string | null; threshold: number | null };

export interface AuditRecord {
  /** Null when the entry no longer says which record it belonged to. */
  kind: AuditRecordKind | null;
  id: number | null;
  /** The record's current name, or the name the entry saved when the record is gone. */
  name: string | null;
  /** The record is still in this tree, so the log can link to it. */
  live: boolean;
  item: AuditRecordItem | null;
}

export interface AuditEditor {
  userId: number;
  name: string;
}
export interface AuditEditorsResult {
  users: AuditEditor[];
}

export interface AuditClient {
  list(options?: AuditListOptions): Promise<AuditListResult>;
  /** Distinct editors for the Who filter. */
  users(treeId?: number | null): Promise<AuditEditorsResult>;
  /** ids is always an array (single revert passes `[id]`). */
  revert(ids: number[], treeId?: number | null): Promise<{ success: true; revertedCount: number }>;
}

// ---- Dashboard ----
export interface OpenCase {
  Id: number; Title: string; Status: string; Tags: string[]; UpdatedAt: string; LastComment: string | null;
  /** The last comment's time and author (#53), null with no comment. */
  LastCommentAt: string | null; LastCommentUserId: number | null; LastCommentAuthor: string | null;
}
/** A person as the desktop home's pick-up card shows them, without the change that brought them there. */
export interface CardPerson {
  Id: number; FirstName: string | null; LastName: string | null; EffectiveFirstName: string | null;
  Nickname: string | null; Sex: string | null; BirthDate: string | null; BirthPlace: string | null;
  DeathDate: string | null; DeathPlace: string | null; IsDeceased: number | null; PrimaryMediaId: number | null;
  FocalX: number | null; FocalY: number | null; FocalRadius: number | null;
  partnershipCount: number; childrenCount: number;
  /** Same rules as the person hero's "X/Y sourced" tag: birth, death and each event. */
  totalFacts: number; sourcedFacts: number;
  /** The desktop home's "Next for <name>" (#53): up to three gaps, and how many in all. */
  nextSteps: { steps: NextStep[]; total: number };
}
export interface ResumedPerson extends CardPerson {
  lastChange: { Action: string; EntityLabel: string | null; Changes: { fields?: Record<string, { old: unknown; new: unknown }> }; CreatedAt: string };
}
/** A recently edited person and their latest change (the phone home's "Recently edited"). */
export interface RecentPerson {
  Id: number; FirstName: string | null; LastName: string | null; EffectiveFirstName: string | null;
  Nickname: string | null; Sex: string | null; PrimaryMediaId: number | null;
  FocalX: number | null; FocalY: number | null; FocalRadius: number | null;
  lastChange: { Action: string; Changes: { fields?: Record<string, { old: unknown; new: unknown }> }; CreatedAt: string };
}
export interface DashboardData {
  /** `casesInProgress` counts every in-progress case; `openCases` lists the newest five. */
  stats: { people: number; families: number; events: number; sources: number; casesInProgress: number };
  openCases: OpenCase[];
  recentActivity: ActivityRow[];
  /** `own_count` < `person_count` means the total includes gazetteer sub-places. */
  places: Array<{ place_id: number; place_name: string; person_count: string; own_count: string; country: string | null }>;
  /** How many places the tree's facts name, in how many known countries (#53). */
  placeTotals: { places: number; countries: number };
  /** The earliest and latest birth or death year (#53's band). */
  yearSpan: { first: number | null; last: number | null };
  resumedPerson: ResumedPerson | null;
  /**
   * With no `resumedPerson` and at least one person: the person the tree opens at,
   * which the desktop pick-up card shows instead (Heirloom #127). Null otherwise.
   */
  startPerson: CardPerson | null;
  /** Up to six other recently edited people, newest first, skipping `resumedPerson`. */
  recentPeople: RecentPerson[];
}
export interface Suggestion {
  type: 'duplicates';
  count: number;
  href: string;
}

export interface DashboardClient {
  get(treeId?: number | null): Promise<DashboardData>;
  suggestions(treeId?: number | null): Promise<Suggestion[]>;
}

// ---- Data checks (#786) ----
interface DataCheckConfirmation {
  reason: string;
  confirmedBy: number;
  confirmedByName: string | null;
  confirmedAt: string;
}

/** A problem, and its confirmation while that still applies (unlikely problems only, #830). */
export interface DataCheckEntry extends DataCheckProblem {
  confirmation: DataCheckConfirmation | null;
}

export interface DataChecksResult {
  /** Computed on demand, never stored. */
  problems: DataCheckEntry[];
  /** Name and vitals of every person a problem lists, and each listed family's partners. */
  people: DataCheckPersonName[];
  /** The partners of every family a problem lists, to name a family filter (#831). */
  families: Array<{ Id: number; Partner1Id: number | null; Partner2Id: number | null }>;
}

/** What home shows of a tree's checks (#1270): the count still to check, and the first few. */
export interface DataChecksSummary {
  openCount: number;
  /** The first open entries in the list's order, with only the people and families they name. */
  top: DataChecksResult;
}

/** Narrow the list to one person's timeline or one family (#833). */
export interface DataChecksFilter {
  personId?: number;
  familyId?: number;
}

export interface DataChecksClient {
  list(treeId?: number | null, filter?: DataChecksFilter): Promise<DataChecksResult>;
  /** The count still to check and the first few entries, without the rest of the list. */
  summary(treeId?: number | null): Promise<DataChecksSummary>;
  /** Confirm an unlikely problem as correct. Editors and contributors only; a reason is required. */
  confirm(problemId: string, reason: string, treeId?: number | null): Promise<DataCheckEntry>;
  /** Reopen a confirmed problem, so it's back to To check. */
  reopen(problemId: string, treeId?: number | null): Promise<void>;
  /** The dates one person's problems depend on, to preview a date fix in the browser (#832). */
  neighbourhood(personId: number, treeId?: number | null): Promise<DataCheckInput>;
}

// ---- GEDCOM / Import-Export ----
export interface SkippedRecord { type: 'person' | 'family'; identifier: string; reason: string; }
export type GedcomImportWarning =
  | { code: 'sidecar_version_newer'; values: { sidecarName: string; declared: number; supported: number } }
  /** Merge found people whose xref was taken by someone with a different name, and added them as new (#871). */
  | { code: 'merge_xref_name_mismatch'; values: { count: number } }
  /** Families listing more than two partners: the extras were kept as raw GEDCOM, not linked (#873). */
  | { code: 'family_extra_partners'; values: { count: number } }
  /** The file's encoding was missing or wrong, so it was read with a guessed charset (#875). */
  | { code: 'charset_guessed'; values: { charset: string } }
  /** Pointers to records missing from the file, by kind; each imported as nothing (#880). */
  | { code: 'dropped_links'; values: { kind: 'source' | 'note' | 'media' | 'family' | 'person'; count: number } }
  /** Records reusing an earlier record's xref (#880). */
  | { code: 'duplicate_xrefs'; values: { count: number } }
  /** Child links whose pedigree value (PEDI step, sealing, …) has no RelationshipType; kept raw (#954). */
  | { code: 'child_relationship_unmapped'; values: { count: number; values: string } }
  /** Inline `SOUR <text>` citations with no source record, kept as GEDCOM text (#963). */
  | { code: 'inline_citations_kept'; values: { count: number } }
  /** Citations on a NOTE or OBJE record (or otherwise unplaceable), not imported (#963). */
  | { code: 'citations_unplaced'; values: { count: number } }
  /** Vendor level-0 records (`_EVENT_DEFN`, `_PLAC`, …) the app doesn't keep, with their tags (#967). */
  | { code: 'custom_records_dropped'; values: { count: number; tags: string } }
  /** GEDCOM 5.5 BLOB images embedded in the file, imported as media without the image (#977). */
  | { code: 'media_blobs_dropped'; values: { count: number } }
  /** `NOTE` records nothing in the file points at (Gramps' tree description), not imported (#995). */
  | { code: 'notes_unattached'; values: { count: number } }
  /** Lines under a place the app doesn't keep (ArkivDigital's `_ADPL`), with their tags; the place name is kept (#992). */
  | { code: 'place_lines_dropped'; values: { count: number; tags: string } }
  /** Passthrough pointers to records the app doesn't keep (SUBM, a vendor record, a missing one), not imported (#979). */
  | { code: 'raw_pointers_dropped'; values: { count: number; tags: string } }
  /** Media FILE paths that are absolute or web addresses, kept as references to add later (#958). */
  | { code: 'external_media_references'; values: { count: number } }
  /** Merge added media whose files weren't in the bundle; without bytes they can't be matched (#960). */
  | { code: 'merge_media_without_files'; values: { count: number } }
  /** Overwrite deleted media whose files couldn't be removed from server storage (#945). */
  | { code: 'media_cleanup_failed'; values: { count: number } }
  /** Records naming a place two places in the tree share, linked to the most-used one (#1186). */
  | { code: 'places_shared_name'; values: { count: number; places: string; people: string; more: number } };

export interface GedcomDryRunResponse {
  dryRun: true; mode: string;
  toImport: { peopleCount: number; familiesCount: number; childrenCount: number; mediaCount: number; sourcesCount: number; citationsCount: number };
  // Deduped basenames of every media file the client must upload (person media +
  // library photos). Lets the client warn about files missing from the zip before
  // a destructive overwrite import deletes the existing, working media.
  expectedMediaFilenames?: string[];
  /** Collision-safe archive identities for xref-keyed bundles. */
  expectedMediaRefs?: Array<{ archivePath: string; originalFilename: string; basenameFallback?: boolean }>;
  skipped: SkippedRecord[];
}
export interface GedcomImportResponse {
  success: boolean; mode: string;
  peopleCount: number; familiesCount: number; casesCount: number;
  tagsCount: number; libraryMediaCount: number;
  sourcesCount: number; citationsCount: number;
  /** Records whose unmodeled GEDCOM was preserved verbatim via raw passthrough (4.2). */
  preservedCount: number;
  /** Relationship links dropped because the referenced person was absent from the file (4.2). */
  skippedCount: number;
  /** Merge: people and families already in the tree, matched and left unchanged (#880). */
  matchedPeopleCount: number;
  matchedFamiliesCount: number;
  /** Durable import lineage, one item per referenced FILE placeholder. */
  mediaItems: MediaImportItem[];
  /** Overwrite: replaced media files left on disk because their unlink failed (#945). Always 0 locally. */
  cleanupWarningCount: number;
  warnings: GedcomImportWarning[]; message: string;
}

export type MediaOmissionReason =
  | 'pending'
  | 'missing'
  | 'failed'
  | 'backing_missing'
  | 'legacy_materialization_unknown';

/** Aggregate-only media export preflight; never add IDs, paths, or raw errors. */
export interface MediaExportPreflight {
  canExport: boolean;
  omittedTotal: number;
  byReason: Record<MediaOmissionReason, number>;
}

/** Browser/local and hosted export adapters return the same artifact shape. */
export interface ExportArtifact {
  blob: Blob;
  filename: string;
}

export interface GedcomExportOptions {
  includeMedia?: boolean;
  /** Only the exact value `omit-unresolved` permits an incomplete media bundle. */
  mediaPolicy?: string;
}

export type MediaImportMaterializationOutcome =
  | {
      outcome: 'ready' | 'already_ready'; item: MediaImportItem; failureCode: null; retryable: false;
      /**
       * The bytes matched a photo already in this tree, so the import's links moved
       * onto it and no second copy was stored (#858). `item` then describes an
       * import item that no longer exists, with `mediaId` set to the reused photo.
       */
      reused?: true;
    }
  | { outcome: 'failed'; item: MediaImportItem | null; failureCode: MediaImportFailureCode; retryable: true };
export interface SpreadsheetDryRunResponse {
  dryRun: true;
  toImport: { peopleCount: number; familiesCount: number; childrenCount: number };
  skipped: SkippedRecord[];
}
export interface SpreadsheetImportResponse {
  dryRun: false; peopleImported: number; familiesImported: number; childrenLinked: number; skipped: SkippedRecord[];
}

export interface GedcomClient {
  preflightExport(treeId?: number | null): Promise<MediaExportPreflight>;
  exportGedcom(options?: GedcomExportOptions, treeId?: number | null): Promise<ExportArtifact>;
  previewGedcom(input: { file: File; mode: 'overwrite' | 'merge'; mediaJson?: string | null; sourcesJson?: string | null }, treeId?: number | null): Promise<GedcomDryRunResponse>;
  /** `onProgress` is called as each import phase starts. Only the in-browser
   *  (local) client reports it; a hosted import is a single request. */
  importGedcom(input: { file: File; mode: 'overwrite' | 'merge'; casesJson?: string | null; mediaJson?: string | null; sourcesJson?: string | null; placesJson?: string | null; archiveManifest?: string[]; onProgress?: (step: GedcomImportStep) => void }, treeId?: number | null): Promise<GedcomImportResponse>;
  listUnresolvedImportMedia(treeId?: number | null): Promise<MediaImportItem[]>;
  markImportMediaMissing(itemIds: number[], treeId?: number | null): Promise<MediaImportItem[]>;
  materializeImportMedia(itemId: number, archivePath: string, file: File, treeId?: number | null): Promise<MediaImportMaterializationOutcome>;
  removeUnresolvedImportMedia(itemId: number, treeId?: number | null): Promise<void>;
  /** Removes up to 100 unresolved items at once; returns the ids removed (ready or gone items are skipped). */
  removeUnresolvedImportMediaBatch(itemIds: number[], treeId?: number | null): Promise<number[]>;
  previewSpreadsheet(file: File, dateFormat: 'MDY' | 'DMY', treeId?: number | null): Promise<SpreadsheetDryRunResponse>;
  importSpreadsheet(file: File, dateFormat: 'MDY' | 'DMY', treeId?: number | null): Promise<SpreadsheetImportResponse>;
  reset(): Promise<{ success: true; message: string }>;
}

// ---- Cases ----
export interface ListCasesOptions {
  treeId?: number | null; status?: string; tag?: string; search?: string; personId?: number;
}
/** A case's scope (#58): years, a focus place, and the kind of question it started as. */
interface CaseScopeInput {
  FromYear?: number | null; ToYear?: number | null; Place?: string | null; QuestionKind?: string | null;
}
export interface CreateCaseInput extends CaseScopeInput {
  Title: string; Description?: string | null;
  Status?: 'in_progress' | 'on_hold' | 'closed'; Tags?: string[]; personIds?: number[];
}
export interface UpdateCaseInput extends CaseScopeInput {
  Title?: string; Description?: string | null;
  Status?: 'in_progress' | 'on_hold' | 'closed'; Tags?: string[]; personIds?: number[]; mediaIds?: number[];
  /** Required when Status moves to 'closed': the case's answer, written as its final journal entry (#801). */
  Conclusion?: string;
  /** How the case closed (#58); kept only when it closes. */
  Outcome?: CaseOutcome | null;
}
export interface AddCommentInput { body: string; mediaId?: number | null; leadIds?: number[]; }

// ---- The research workspace (#58, ADR 0045) ----
export interface CaseLeadInput { question: string; fromYear?: number | null; toYear?: number | null; personIds?: number[]; }
export type CaseLeadChange = { action: 'edit' } & CaseLeadInput | { action: 'settle' | 'reopen' | 'drop' };
export interface CaseClaimInput {
  what: string; personId?: number | null; personName?: string | null; says?: string | null;
  date?: string | null; place?: string | null; evidence?: CaseClaimEvidence | null;
}
export type CaseFindingInput = {
  kind: 'record';
  leadIds?: number[];
  /** An existing source in the tree, or a new one to make. */
  source: { id: number } | { title: string; repository?: string | null };
  page?: string | null; url?: string | null; transcription?: string | null; mediaId?: number | null;
  sourceNature?: CaseSourceNature | null; information?: CaseInformation | null; note?: string | null;
  requestId?: number | null;
  claims?: CaseClaimInput[];
  /** A journal note whose photo or citation this record is (#58). */
  commentId?: number | null;
} | {
  kind: 'nothing';
  leadIds?: number[];
  searched: string; site?: string | null; note?: string | null; requestId?: number | null;
};
export interface CaseRequestInput {
  askedFor: string; leadId?: number | null; holder?: string | null; sentBy?: CaseRequestSentBy | null;
  sentOn?: string | null; reference?: string | null; remindOn?: string | null;
}
/** Answer and close (#58): the answer, how it ended, and the claims to put into the tree. */
export interface CloseCaseInput {
  conclusion: string; outcome: CaseOutcome;
  apply: Array<{ claimId: number; replace?: boolean }>;
}
/** A workspace write's answer: the new row's id when it made one, and the workspace after it. */
export interface CaseWorkspaceWrite { id: number | null; workspace: CaseWorkspace; }
export interface LinkMediaInput { mediaIds: number[]; }

export interface CasesClient {
  list(options?: ListCasesOptions): Promise<{ cases: CaseWithRelations[]; count: number }>;
  get(id: number, treeId?: number | null): Promise<CaseWithRelations>;
  create(input: CreateCaseInput, treeId?: number | null): Promise<Case>;
  update(id: number, patch: UpdateCaseInput, treeId?: number | null): Promise<Case>;
  remove(id: number, treeId?: number | null): Promise<void>;
  addComment(id: number, input: AddCommentInput, treeId?: number | null): Promise<CaseComment>;
  /** Strike a journal note out as no longer accurate (#1251, ADR 0042); entries are never edited or deleted. */
  strikeComment(id: number, commentId: number, reason: string | null, treeId?: number | null): Promise<Audited<CaseNoteStrike>>;
  /** Undo a journal note's strike-out (#1251). */
  unstrikeComment(id: number, commentId: number, treeId?: number | null): Promise<Audited<CaseNoteStrike>>;
  listMediaLibrary(id: number, treeId?: number | null): Promise<MediaWithPerson[]>;
  linkMedia(id: number, input: LinkMediaInput, treeId?: number | null): Promise<{ linked: number }>;
  unlinkMedia(id: number, mediaId: number, treeId?: number | null): Promise<void>;
  /** The case's leads, findings and requests (#58). */
  getWorkspace(id: number, treeId?: number | null): Promise<CaseWorkspace>;
  addLead(id: number, input: CaseLeadInput, treeId?: number | null): Promise<CaseWorkspaceWrite>;
  changeLead(id: number, leadId: number, change: CaseLeadChange, treeId?: number | null): Promise<CaseWorkspaceWrite>;
  addFinding(id: number, input: CaseFindingInput, treeId?: number | null): Promise<CaseWorkspaceWrite>;
  addClaim(id: number, findingId: number, input: CaseClaimInput, treeId?: number | null): Promise<CaseWorkspaceWrite>;
  decideClaim(id: number, claimId: number, decision: CaseClaimDecision, treeId?: number | null): Promise<CaseWorkspaceWrite>;
  addRequest(id: number, input: CaseRequestInput, treeId?: number | null): Promise<CaseWorkspaceWrite>;
  replyToRequest(id: number, requestId: number, reply: { state: CaseRequestState; note?: string | null }, treeId?: number | null): Promise<CaseWorkspaceWrite>;
  /** What Answer and close would change in the tree (#58, ADR 0046). */
  getChanges(id: number, treeId?: number | null): Promise<CaseChange[]>;
  /** Close the case with its answer, putting the chosen claims into the tree. */
  close(id: number, input: CloseCaseInput, treeId?: number | null): Promise<CaseWorkspaceWrite>;
  /** Put back what Answer and close changed for one claim. */
  undoApplied(id: number, claimId: number, treeId?: number | null): Promise<CaseWorkspaceWrite>;
}

export type { Source, SourceWithCitationCount } from '@/lib/db/queries/sources';
export type { Citation, CitedByRow } from '@/lib/db/queries/citations';
export type { Note, NoteLinkEnd, NoteOwnerFact } from '@/lib/db/queries/notes';
export type { Repository, RepositoryWithCount } from '@/lib/db/queries/repositories';
export type { AuditLogEntryWithUser } from '@/lib/db/schema';
export type { Case, CaseComment, CaseWithRelations } from '@/lib/db/schema';

/**
 * The single interface all UI data access goes through. `HttpDataClient` (hosted)
 * and `LocalDataClient` (static/PGlite) both implement it. Grows one namespace
 * per entity as later plans migrate them.
 */
/**
 * Multi-tree management (distinct from `tree` — the visualization data client).
 * `list`/`get` are cache-allowlisted reads; create/rename/remove invalidate.
 */
export interface TreesClient {
  list(): Promise<{ trees: Tree[]; count: number }>;
  get(id: number): Promise<{ tree: Tree; permission: 'owner' | 'edit' | 'contribute' | 'view' }>;
  create(name: string): Promise<Tree>;
  rename(id: number, name: string): Promise<Tree>;
  /** `cleanupWarningCount`: media files left on server storage (#945); always 0 locally. */
  remove(id: number): Promise<{ cleanupWarningCount: number }>;
}

// ---- Account (#35) ----
/**
 * Per-user app state that follows the account rather than a tree. Its writes
 * skip cache invalidation (`UNCACHED_SUB_CLIENTS`), so it must never hold a
 * method that changes anything the data cache keeps.
 */
export interface AccountClient {
  /** The last version whose What's new this user has seen, or null before the first. */
  getLastSeenVersion(): Promise<string | null>;
  setLastSeenVersion(version: string): Promise<void>;
}

export interface DataClient {
  account: AccountClient;
  people: PeopleClient;
  relationship: RelationshipClient;
  places: PlacesClient;
  families: FamiliesClient;
  events: EventsClient;
  tree: TreeClient;
  trees: TreesClient;
  media: MediaClient;
  sources: SourcesClient;
  citations: CitationsClient;
  repositories: RepositoriesClient;
  notes: NotesClient;
  audit: AuditClient;
  dashboard: DashboardClient;
  dataChecks: DataChecksClient;
  gedcom: GedcomClient;
  cases: CasesClient;
}
