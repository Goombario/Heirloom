import type { AuditLogEntry } from '@/lib/db/schema';

/**
 * How the audit log shows one stored field (#551): a translated label, and how
 * to render its values. The log used to print raw column names and ids
 * (`Partner1Id · 812 → 907`, `FocalX`, `DeathDate · 1814-01-27`).
 *
 * - `person` / `family`: an id, shown as the name from the list's `refs`.
 * - `coords`: a `[latitude, longitude]` pair, shown to four decimals.
 * - `opaque`: a crop or tag region, or an internal id list. Its values mean nothing to a reader,
 *   so the row says only that it changed.
 */
type AuditFieldKind =
    | 'text' | 'date' | 'person' | 'family' | 'sex' | 'flag'
    | 'caseStatus' | 'childType' | 'familyType' | 'eventType' | 'coords' | 'opaque';

export interface AuditFieldSpec {
    /** Key under the `audit` namespace, without the `field_` prefix. */
    label: string;
    kind: AuditFieldKind;
}

const spec = (label: string, kind: AuditFieldKind = 'text'): AuditFieldSpec => ({ label, kind });

/** Fields whose meaning is the same on every entity. */
const COMMON_FIELDS: Record<string, AuditFieldSpec> = {
    FirstName: spec('first_name'),
    LastName: spec('last_name'),
    Sex: spec('sex', 'sex'),
    BirthDate: spec('birth_date', 'date'),
    BirthPlace: spec('birth_place'),
    DeathDate: spec('death_date', 'date'),
    DeathPlace: spec('death_place'),
    DeathCause: spec('death_cause'),
    IsDeceased: spec('deceased', 'flag'),
    Partner1Id: spec('partner1', 'person'),
    Partner2Id: spec('partner2', 'person'),
    MarriageDate: spec('marriage_date', 'date'),
    MarriagePlace: spec('marriage_place'),
    Date: spec('date', 'date'),
    Place: spec('place'),
    Description: spec('description'),
    PersonId: spec('person', 'person'),
    FamilyId: spec('family', 'family'),
    ChildId: spec('child', 'person'),
    // A data check confirmation's reason (#830).
    Reason: spec('reason'),
    Title: spec('title'),
    Author: spec('author'),
    PublicationInfo: spec('publication'),
    RepositoryName: spec('repository'),
    CallNumber: spec('call_number'),
    Text: spec('text'),
    Contents: spec('contents'),
    ToldBy: spec('told_by'),
    Abbreviation: spec('abbreviation'),
    Page: spec('page'),
    Quay: spec('quality'),
    DataText: spec('data_text'),
    Url: spec('record_link'),
    Status: spec('status', 'caseStatus'),
    Tags: spec('tags'),
    Name: spec('name'),
    FromDate: spec('from_date', 'date'),
    ToDate: spec('to_date', 'date'),
    IsPrimary: spec('primary', 'flag'),
    Format: spec('format'),
    FocalX: spec('photo_focus', 'opaque'),
    FocalY: spec('photo_focus', 'opaque'),
    FocalRadius: spec('photo_focus', 'opaque'),
    RegionX: spec('tag_area', 'opaque'),
    RegionY: spec('tag_area', 'opaque'),
    RegionW: spec('tag_area', 'opaque'),
    RegionH: spec('tag_area', 'opaque'),
    // One type for both partners before #982; kept so older entries still read.
    RelationshipType: spec('child_relationship', 'childType'),
    Partner1Relationship: spec('partner1_relationship', 'childType'),
    Partner2Relationship: spec('partner2_relationship', 'childType'),
    // Canonical media summaries (primary photo, who a photo belongs to).
    CanonicalPrimaryMediaId: spec('primary_photo', 'opaque'),
    CanonicalPeopleOwnerIds: spec('linked_people', 'opaque'),
};

/**
 * A place geocode, coordinate or hierarchy edit's readable details (#924). The
 * raw columns ride in the entry for revert; these are what a reader sees.
 */
const PLACE_FIELDS: Record<string, AuditFieldSpec> = {
    Name: spec('place_name'),
    Coordinates: spec('coordinates', 'coords'),
    DisplayName: spec('matched_place'),
    PinSuppressed: spec('pin_hidden', 'flag'),
    PartOf: spec('part_of'),
};

/** `Type` means something different on each entity. */
const TYPE_FIELDS: Record<string, AuditFieldSpec> = {
    family: spec('family_type', 'familyType'),
    event: spec('event_type', 'eventType'),
    namevariant: spec('name_type'),
    source: spec('source_type'),
    story: spec('source_type'),
};

/**
 * The display spec for one field, or null when the field is internal (ids,
 * owners, file storage, timestamps, raw GEDCOM) and shouldn't be shown.
 * Anything not listed here is internal, so a new column stays hidden until
 * someone gives it a label.
 */
export function auditFieldSpec(entityType: string, field: string): AuditFieldSpec | null {
    if (entityType === 'place') return PLACE_FIELDS[field] ?? null;
    if (field === 'Type') return TYPE_FIELDS[entityType] ?? null;
    return COMMON_FIELDS[field] ?? null;
}

/** Person and family ids an entry's change details refer to. */
function refIds(entry: Pick<AuditLogEntry, 'EntityType' | 'Changes'>, people: Set<number>, families: Set<number>): void {
    const changes = entry.Changes as { fields?: Record<string, { old: unknown; new: unknown }>; snapshot?: Record<string, unknown> } | null;
    const add = (field: string, value: unknown) => {
        const kind = auditFieldSpec(entry.EntityType, field)?.kind;
        const id = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null;
        if (id == null) return;
        if (kind === 'person') people.add(id);
        else if (kind === 'family') families.add(id);
    };
    for (const [field, diff] of Object.entries(changes?.fields ?? {})) {
        add(field, diff?.old);
        add(field, diff?.new);
    }
    for (const [field, value] of Object.entries(changes?.snapshot ?? {})) add(field, value);
}

/** Every person and family id a page of entries refers to, for one name lookup. */
export function auditRefIds(entries: Pick<AuditLogEntry, 'EntityType' | 'Changes'>[]): { people: number[]; families: number[] } {
    const people = new Set<number>();
    const families = new Set<number>();
    for (const entry of entries) refIds(entry, people, families);
    return { people: [...people], families: [...families] };
}
