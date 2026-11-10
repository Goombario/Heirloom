/**
 * The data checks' rule table and output shape (#786, #828).
 *
 * A rule ID is stable: confirmations (#830) key on it, and each rule has one
 * ICU message per locale. Rules are listed in display order, impossible first.
 * A new rule must say which date it edits and whether it is impossible or
 * unlikely; only unlikely problems can be confirmed (#786, "Consequences").
 */

import type { FACT_TABLES } from '@/lib/db/fact-tables';

/** Impossible: can only be fixed. Unlikely: can be confirmed with a reason. Unreadable: record shape. */
export type DataCheckKind = 'impossible' | 'unlikely' | 'unreadable';

export const DATA_CHECK_RULES = [
    { id: 'death_before_birth', kind: 'impossible' },
    { id: 'burial_before_death', kind: 'impossible' },
    { id: 'baptism_before_birth', kind: 'impossible' },
    { id: 'event_before_birth', kind: 'impossible' },
    { id: 'event_after_death', kind: 'impossible' },
    { id: 'partnership_ends_before_start', kind: 'impossible' },
    { id: 'child_born_before_parent', kind: 'impossible' },
    { id: 'child_born_after_mother_death', kind: 'impossible' },
    { id: 'child_born_after_father_death', kind: 'impossible' },
    { id: 'partnership_after_death', kind: 'impossible' },
    { id: 'partnership_before_birth', kind: 'impossible' },
    { id: 'died_young_with_family', kind: 'impossible' },
    { id: 'own_ancestor', kind: 'impossible' },
    { id: 'parent_too_young', kind: 'unlikely' },
    { id: 'mother_too_old', kind: 'unlikely' },
    { id: 'married_too_young', kind: 'unlikely' },
    { id: 'died_too_old', kind: 'unlikely' },
    { id: 'living_too_old', kind: 'unlikely' },
    { id: 'unreadable_date', kind: 'unreadable' },
] as const satisfies ReadonlyArray<{ id: string; kind: DataCheckKind }>;

export type DataCheckRuleId = (typeof DATA_CHECK_RULES)[number]['id'];

export const RULE_KIND = Object.fromEntries(DATA_CHECK_RULES.map((r) => [r.id, r.kind])) as Record<DataCheckRuleId, DataCheckKind>;

/** A child can't be born more than this many months after the father's death (Legacy: 10 months; Gramps: 294 days). */
export const FATHER_DEATH_MONTHS = 10;

/** "Died aged 8 or younger": FamilySearch's threshold for someone with children (#970). */
export const DIED_YOUNG_MAX_AGE = 8;

type UnlikelyRuleId = Extract<(typeof DATA_CHECK_RULES)[number], { kind: 'unlikely' }>['id'];

/**
 * The unlikely rules' thresholds, in whole years of age (#829). Fixed in v1.
 * A confirmation stores the threshold it was made against (#830), so changing
 * one here reopens the problems confirmed under the old value.
 *
 *   parent_too_young   a parent under 12 at a child's birth
 *   mother_too_old     a mother over 55 at a child's birth
 *   married_too_young  under 12 when a partnership starts
 *   died_too_old       over 110 at death
 *   living_too_old     marked living, and over 110 today
 */
export const UNLIKELY_THRESHOLDS = {
    parent_too_young: 12,
    mother_too_old: 55,
    married_too_young: 12,
    died_too_old: 110,
    living_too_old: 110,
} as const satisfies Record<UnlikelyRuleId, number>;

/** The threshold a rule was checked against, or null for a rule without one. */
export function ruleThreshold(rule: DataCheckRuleId): number | null {
    return (UNLIKELY_THRESHOLDS as Partial<Record<DataCheckRuleId, number>>)[rule] ?? null;
}

// ---- Input ----

export interface DataCheckPerson {
    Id: number;
    Sex: string | null;
    BirthDate: string | null;
    DeathDate: string | null;
    IsDeceased: number | null;
}

export interface DataCheckEvent {
    Id: number;
    Type: string;
    Date: string | null;
    PersonId: number | null;
    FamilyId: number | null;
}

export interface DataCheckFamily {
    Id: number;
    Partner1Id: number | null;
    Partner2Id: number | null;
    /** The partnership's start. */
    MarriageDate: string | null;
    childIds: number[];
    /**
     * The children in `childIds` who aren't Partner1's / Partner2's birth child
     * (adopted, fostered, a stepchild, a ward or unknown), from
     * `FamilyPerson."Partner1Relationship"` / `"Partner2Relationship"` (#982).
     * Absent means every link to that partner is a birth link, the default.
     */
    partner1NonBirthChildIds?: number[];
    partner2NonBirthChildIds?: number[];
}

export interface DataCheckInput {
    people: DataCheckPerson[];
    events: DataCheckEvent[];
    families: DataCheckFamily[];
}

// ---- Output ----

/**
 * Where a checked date is stored. Birth, death and the partnership start are
 * columns on People and Families rather than Events rows, so a date is named by
 * the citation system's fact address (`FACT_TABLES`) instead of an event ID.
 */
export type DataCheckFactTable =
    | typeof FACT_TABLES.PERSON_BIRTH
    | typeof FACT_TABLES.PERSON_DEATH
    | typeof FACT_TABLES.FAMILIES
    | typeof FACT_TABLES.EVENTS;

export interface DataCheckFact {
    /** `${table}:${id}`, e.g. "PersonDeath:12". Confirmations store these. */
    key: string;
    table: DataCheckFactTable;
    id: number;
    /** GEDCOM tag: BIRT, DEAT, MARR, or the event's own Type. */
    type: string;
    personId: number | null;
    familyId: number | null;
    /** The stored date string, as it was when checked. */
    date: string;
}

export interface DataCheckProblem {
    /** `${rule}:${personId}`: one entry per person per rule. */
    id: string;
    rule: DataCheckRuleId;
    kind: DataCheckKind;
    /** For an unlikely rule, the threshold it was checked against (UNLIKELY_THRESHOLDS). */
    threshold: number | null;
    /** The person whose date is most likely wrong; the entry is listed under them. */
    personId: number;
    /** The other people involved, e.g. the children born after a parent's death. */
    relatedPersonIds: number[];
    /** Families involved, for the hero flag and the family filter. */
    familyIds: number[];
    /** Every date involved in the conflict. */
    facts: DataCheckFact[];
    /**
     * Keys of the facts to fix in place. Two for death before birth; none for a
     * cycle or a living flag, which aren't dates; one for every other rule.
     */
    editable: string[];
}
