/**
 * Canonical FactTable values for the Citation system. A citation links a Source
 * to a single fact via (FactTable, FactId). These constants are the single
 * source of truth — UI and queries must use them rather than string literals so
 * that what gets written matches what gets read back.
 */
export const FACT_TABLES = {
    /** Whole-person record (legacy bucket). FactId = Person.Id */
    PEOPLE: 'People',
    /** A whole-family / partnership record. FactId = Families.Id */
    FAMILIES: 'Families',
    /** A family's marriage (date + place). FactId = Families.Id (#962) */
    FAMILY_MARRIAGE: 'FamilyMarriage',
    /** A discrete life event. FactId = Events.Id */
    EVENTS: 'Events',
    /** Birth fact (date + place). FactId = Person.Id */
    PERSON_BIRTH: 'PersonBirth',
    /** Death fact (date + place). FactId = Person.Id */
    PERSON_DEATH: 'PersonDeath',
    /** Primary given name. FactId = Person.Id */
    PERSON_NAME: 'PersonName',
    /** A name variant / alias. FactId = NameVariant.Id */
    NAME_VARIANT: 'NameVariant',
    /** A research case. FactId = Cases.Id */
    CASES: 'Cases',
    /** A single research-journal entry (comment). FactId = CaseComments.Id */
    CASE_COMMENTS: 'CaseComments',
    /** A case finding's record (#58, ADR 0045). FactId = CaseFindings.Id */
    CASE_FINDINGS: 'CaseFindings',
} as const;

export type FactTableValue = (typeof FACT_TABLES)[keyof typeof FACT_TABLES];

/** Runtime set for validating untrusted input against the FactTable enum. */
const FACT_TABLE_VALUES: ReadonlySet<FactTableValue> = new Set(
    Object.values(FACT_TABLES) as FactTableValue[]
);

export function isFactTableValue(value: unknown): value is FactTableValue {
    return typeof value === 'string' && FACT_TABLE_VALUES.has(value as FactTableValue);
}

/**
 * Fact tables whose FactId is a Person.Id (as opposed to a row id in another
 * table such as Events or NameVariant). Used by person-scoped citation queries.
 */
export const PERSON_KEYED_FACT_TABLES: readonly FactTableValue[] = [
    FACT_TABLES.PEOPLE,
    FACT_TABLES.PERSON_BIRTH,
    FACT_TABLES.PERSON_DEATH,
    FACT_TABLES.PERSON_NAME,
];

/**
 * Owner vocabulary for the polymorphic link tables (`NoteLink`, and later
 * `MediaLink`). Unlike FACT_TABLES — which includes person-keyed pseudo-facts
 * like 'PersonBirth' — these are REAL tables whose `OwnerId` is a row id in that
 * table. This is the single source of truth for "what a note (or photo) can
 * attach to," mirroring how `Citation(FactTable, FactId)` already attaches
 * sources. Grow this set as new attachable contexts are added.
 */
export const LINK_OWNER_TABLES = {
    PEOPLE: 'People',
    FAMILIES: 'Families',
    EVENTS: 'Events',
    SOURCES: 'Sources',
    PLACES: 'Places',
    /**
     * An archive holding sources. Added for GEDCOM's `REPOSITORY_RECORD +1
     * <<NOTE_STRUCTURE>>` (ged551-2.txt:227-232) — a standard sub-structure that was
     * previously dropped on import with no passthrough to catch it (ADR 0012).
     */
    REPOSITORY: 'Repository',
} as const;

export type LinkOwnerTable = (typeof LINK_OWNER_TABLES)[keyof typeof LINK_OWNER_TABLES];

const LINK_OWNER_TABLE_VALUES: ReadonlySet<LinkOwnerTable> = new Set(
    Object.values(LINK_OWNER_TABLES) as LinkOwnerTable[]
);

/** Validate untrusted input (e.g. an API body) against the link-owner vocabulary. */
export function isLinkOwnerTable(value: unknown): value is LinkOwnerTable {
    return typeof value === 'string' && LINK_OWNER_TABLE_VALUES.has(value as LinkOwnerTable);
}

/**
 * Tables that a media record may attach to. This intentionally differs from
 * LinkOwnerTable: notes may also attach to Places and Repository, while media
 * attachment is limited to concrete genealogical records with media support.
 */
export const MEDIA_OWNER_TABLES = {
    PEOPLE: 'People',
    FAMILIES: 'Families',
    EVENTS: 'Events',
    SOURCES: 'Sources',
    /**
     * One citation (#47): a file that proves a single entry, such as one page of a
     * register. GEDCOM's MULTIMEDIA_LINK under a SOURCE_CITATION (ged551-2.txt).
     */
    CITATIONS: 'Citation',
} as const;

export type MediaOwnerTable = (typeof MEDIA_OWNER_TABLES)[keyof typeof MEDIA_OWNER_TABLES];

const MEDIA_OWNER_TABLE_VALUES: ReadonlySet<MediaOwnerTable> = new Set(
    Object.values(MEDIA_OWNER_TABLES) as MediaOwnerTable[]
);

/** Validate untrusted input against the narrower media-owner vocabulary. */
export function isMediaOwnerTable(value: unknown): value is MediaOwnerTable {
    return typeof value === 'string' && MEDIA_OWNER_TABLE_VALUES.has(value as MediaOwnerTable);
}

/**
 * The vital facts a media link can be scoped to (`MediaLink."OwnerFact"`, ADR 0030),
 * with the one owner table each belongs to. The same vocabulary `NoteLink` uses.
 */
export type MediaOwnerFact = 'Birth' | 'Death' | 'Marriage';

const MEDIA_OWNER_FACT_TABLE: Record<MediaOwnerFact, MediaOwnerTable> = {
    Birth: MEDIA_OWNER_TABLES.PEOPLE,
    Death: MEDIA_OWNER_TABLES.PEOPLE,
    Marriage: MEDIA_OWNER_TABLES.FAMILIES,
};

/** Validate untrusted input: a fact that exists on this owner table. */
export function isMediaOwnerFactFor(ownerTable: string, value: unknown): value is MediaOwnerFact {
    return typeof value === 'string'
        && Object.hasOwn(MEDIA_OWNER_FACT_TABLE, value)
        && MEDIA_OWNER_FACT_TABLE[value as MediaOwnerFact] === ownerTable;
}
