import { query, getClient } from '@/lib/db/connection';
import { safeRollback } from '@/lib/db/rollback';
import { factPlaceColumnFor, factPlaceRefChanges, factPlaceRefs, factPlaceTextColumns, factPlaceTextSql, type FactPlacePick } from './place-links';
import type { Person, PersonDisplay, NewPerson, PersonWithRelations, Family, GedcomEvent, SpouseRelation, ParentRelation, PersonResult } from '../schema';
import { NotFoundError } from '@/lib/data/errors';
import { hasEditPermission } from './sharing';
import { auditCreate, auditUpdate, auditDelete, withAuditIds, type Audited } from './audit-capture';
import { capturePersonDependents } from './person-dependents';
import { primaryPhotoJoin } from './media-tags';
import { attachMediaToEvents } from './media-links';
import { attachNoteCountsToEvents } from './notes';
import { likeContains } from './like-pattern';

/**
 * SQL expression for a person's effective first name: their primary name variant
 * if one is marked, otherwise the stored FirstName. `alias` is the People row
 * alias in the surrounding query (controlled by us, never user input).
 */
export function effectiveFirstName(alias: string): string {
    return `COALESCE((SELECT nv."Name" FROM "NameVariant" nv WHERE nv."PersonId" = ${alias}."Id" AND nv."IsPrimary" = 1 LIMIT 1), ${alias}."FirstName")`;
}

/**
 * SQL expression for a person's preferred nickname: the primary name variant's
 * name when that variant is a nickname, otherwise NULL. Lets display helpers
 * integrate it as First “Nickname” Middle. `alias` is controlled by us.
 */
export function primaryNickname(alias: string): string {
    // The explicitly-primary nickname when the user has starred one, else the earliest.
    //
    // Requiring IsPrimary made every nickname invisible: nothing in the import path or
    // the UI sets it, so all 36 nickname variants in the live database returned NULL and
    // nicknames appeared to be missing from the app entirely.
    //
    // effectiveFirstName() above is deliberately NOT given the same fallback. It keys off
    // IsPrimary for ANY variant type and means "use this variant as the first name" — a
    // different question. Keeping them independent stops a displayed nickname from
    // silently replacing the first name in every name join.
    return `(SELECT nv."Name" FROM "NameVariant" nv
              WHERE nv."PersonId" = ${alias}."Id" AND nv."Type" = 'Nickname'
              ORDER BY nv."IsPrimary" DESC, nv."Id" ASC LIMIT 1)`;
}

/**
 * SQL expression for a person's full display name, mirroring `displayFullName`
 * in `lib/utils/names.ts`: "First Last" using the effective first name, but with
 * a preferred nickname integrated as First “Nickname” Middle Last. Use this for
 * names built in SQL (e.g. family partner labels) so they match the rest of the
 * app. `alias` is controlled by us, never user input.
 */
export function integratedFullName(alias: string): string {
    const fn = `COALESCE(${alias}."FirstName", '')`;
    const ln = `COALESCE(${alias}."LastName", '')`;
    const nick = primaryNickname(alias);
    const firstWord = `split_part(${fn}, ' ', 1)`;
    const restMiddle = `CASE WHEN POSITION(' ' IN ${fn}) > 0 THEN TRIM(SUBSTRING(${fn} FROM POSITION(' ' IN ${fn}) + 1)) ELSE '' END`;
    const integrated = `TRIM(${firstWord} || ' “' || (${nick}) || '”' || CASE WHEN ${restMiddle} <> '' THEN ' ' || ${restMiddle} ELSE '' END || ' ' || ${ln})`;
    const plain = `TRIM(COALESCE(${effectiveFirstName(alias)}, '') || ' ' || ${ln})`;
    return `CASE WHEN (${nick}) IS NOT NULL THEN ${integrated} ELSE ${plain} END`;
}

/**
 * SQL predicates for the citable birth and death facts. Keep them in step with
 * hasBirthFact()/hasDeathFact() in app/people/view/derive.ts: the People list,
 * the person hero and the dashboard resume card all show the same "X/Y sourced"
 * ratio, so a fact counted on one surface and not another contradicts itself
 * (#658). A flag-only or cause-only death is a death fact.
 */
function hasBirthFactSql(alias: string): string {
    return `(${alias}."BirthDate" IS NOT NULL OR ${alias}."BirthPlaceId" IS NOT NULL)`;
}
function hasDeathFactSql(alias: string): string {
    return `(${alias}."DeathDate" IS NOT NULL OR ${alias}."DeathPlaceId" IS NOT NULL OR ${alias}."DeathCause" IS NOT NULL OR ${alias}."IsDeceased" = 1)`;
}

/** A person's birth and death place text, built from the references (ADR 0037). */
const personPlaces = (alias: string) => factPlaceTextColumns('people', alias);
/** A family's marriage place text. */
const familyPlace = (alias: string) => factPlaceTextColumns('families', alias);

// RawGedcom is intentionally omitted: the People-list query selects an explicit
// column set that excludes that large text field (it is never rendered in the
// list), so the type must not claim it is present. The person detail/edit paths
// read it from the full Person via getPersonById instead. (`Notes` used to be
// omitted here too; the column is gone entirely as of #524 / ADR 0010.)
export interface PersonWithParentFamily extends Omit<Person, 'RawGedcom'> {
    PrimaryMediaId?: number;
    FocalX?: number;
    FocalY?: number;
    FocalRadius?: number | null;
    ParentFamilyId?: number | null;
    FatherName?: string | null;
    FatherFirstName?: string | null;
    FatherLastName?: string | null;
    MotherName?: string | null;
    MotherFirstName?: string | null;
    MotherLastName?: string | null;
    CitationCount?: number;
    /** Count of citable facts: birth, death, and each life event. */
    TotalFacts?: number;
    /** Of those facts, how many have at least one citation. */
    SourcedFacts?: number;
    /** Number of partnership/family rows this person appears in as Partner1 or Partner2. */
    PartnershipCount?: number;
    /** Total children across all partnerships this person belongs to. */
    ChildrenCount?: number;
    /** Space-joined list of this person's name-variant names (for client-side search). */
    AllNames?: string | null;
}

/**
 * Get all people belonging to a specific tree, with primary media info and parent family data.
 * Scope predicates filter "TreeId"; row-to-row joins (e.g. media ownership,
 * parent-family lookups) stay keyed on the owner columns both rows carry.
 */
export async function getAllPeople(treeId: number): Promise<PersonWithParentFamily[]> {
    const result = await query(
        // person_counts pre-aggregates each person's partnership + total-children
        // counts in a single grouped pass (O(People + Families)) instead of two
        // correlated subqueries scanning Families per row (was O(People × Families)).
        `WITH partner_fam AS (
             SELECT COALESCE("Partner1Id", "HusbandId") AS person_id, "Id" AS family_id
               FROM "Families" WHERE "TreeId" = $1 AND COALESCE("Partner1Id", "HusbandId") IS NOT NULL
             UNION ALL
             SELECT COALESCE("Partner2Id", "WifeId") AS person_id, "Id" AS family_id
               FROM "Families" WHERE "TreeId" = $1 AND COALESCE("Partner2Id", "WifeId") IS NOT NULL
         ),
         person_counts AS (
             SELECT pf.person_id,
                    COUNT(DISTINCT pf.family_id)::int AS partnership_count,
                    COUNT(cfp."ChildrenId")::int AS children_count
               FROM partner_fam pf
               LEFT JOIN "FamilyPerson" cfp ON cfp."FamiliesAsChildId" = pf.family_id
              GROUP BY pf.person_id
         ),
         citation_agg AS (
             SELECT c."FactId" AS person_id,
                    COUNT(*) FILTER (WHERE c."FactTable" = 'People')::int AS citation_count,
                    COUNT(*) FILTER (WHERE c."FactTable" = 'PersonBirth') > 0 AS has_birth_citation,
                    COUNT(*) FILTER (WHERE c."FactTable" = 'PersonDeath') > 0 AS has_death_citation
               FROM "Citation" c
              WHERE c."TreeId" = $1 AND c."FactTable" IN ('People', 'PersonBirth', 'PersonDeath')
              GROUP BY c."FactId"
         ),
         event_agg AS (
             SELECT ev."PersonId" AS person_id,
                    COUNT(*)::int AS event_count,
                    COUNT(*) FILTER (WHERE ec."FactId" IS NOT NULL)::int AS sourced_event_count
               FROM "Events" ev
               LEFT JOIN (
                   SELECT DISTINCT c."FactId" FROM "Citation" c
                    WHERE c."TreeId" = $1 AND c."FactTable" = 'Events'
               ) ec ON ec."FactId" = ev."Id"
              WHERE ev."TreeId" = $1
              GROUP BY ev."PersonId"
         )
         SELECT p."Id", p."UserId", p."FirstName", p."LastName", p."Sex", p."GedcomId",
            p."BirthDate", p."DeathDate", ${personPlaces('p')}, p."IsDeceased", p."UpdatedAt",
            ${effectiveFirstName('p')} AS "EffectiveFirstName",
            ${primaryNickname('p')} AS "Nickname",
            (SELECT string_agg(nv."Name", ' ') FROM "NameVariant" nv WHERE nv."PersonId" = p."Id") AS "AllNames",
            m."Id" AS "PrimaryMediaId", m."FocalX", m."FocalY", m."FocalRadius",
            pf."Id" AS "ParentFamilyId",
            CASE WHEN ph."Id" IS NOT NULL THEN TRIM(COALESCE(${effectiveFirstName('ph')}, '') || ' ' || COALESCE(ph."LastName", '')) ELSE NULL END AS "FatherName",
            ${effectiveFirstName('ph')} AS "FatherFirstName", ph."LastName" AS "FatherLastName",
            CASE WHEN pw."Id" IS NOT NULL THEN TRIM(COALESCE(${effectiveFirstName('pw')}, '') || ' ' || COALESCE(pw."LastName", '')) ELSE NULL END AS "MotherName",
            ${effectiveFirstName('pw')} AS "MotherFirstName", pw."LastName" AS "MotherLastName",
            COALESCE(ca.citation_count, 0) AS "CitationCount",
            -- Total citable facts: birth, death, and each life event (see hasBirthFactSql).
            (CASE WHEN ${hasBirthFactSql('p')} THEN 1 ELSE 0 END
             + CASE WHEN ${hasDeathFactSql('p')} THEN 1 ELSE 0 END
             + COALESCE(ea.event_count, 0)) AS "TotalFacts",
            -- Of those facts, how many have at least one citation.
            (CASE WHEN ${hasBirthFactSql('p')} AND COALESCE(ca.has_birth_citation, false) THEN 1 ELSE 0 END
             + CASE WHEN ${hasDeathFactSql('p')} AND COALESCE(ca.has_death_citation, false) THEN 1 ELSE 0 END
             + COALESCE(ea.sourced_event_count, 0)) AS "SourcedFacts",
            COALESCE(pc.partnership_count, 0) AS "PartnershipCount",
            COALESCE(pc.children_count, 0) AS "ChildrenCount"
         FROM "People" p
         ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
         LEFT JOIN LATERAL (
             SELECT f.* FROM "Families" f
             INNER JOIN "FamilyPerson" fp ON f."Id" = fp."FamiliesAsChildId"
             WHERE fp."ChildrenId" = p."Id" AND f."UserId" = p."UserId"
             ORDER BY f."Id"
             LIMIT 1
         ) pf ON true
         LEFT JOIN "People" ph ON ph."Id" = COALESCE(pf."Partner1Id", pf."HusbandId")
         LEFT JOIN "People" pw ON pw."Id" = COALESCE(pf."Partner2Id", pf."WifeId")
         LEFT JOIN person_counts pc ON pc.person_id = p."Id"
         LEFT JOIN citation_agg ca ON ca.person_id = p."Id"
         LEFT JOIN event_agg ea ON ea.person_id = p."Id"
         WHERE p."TreeId" = $1
         ORDER BY p."LastName", p."FirstName"`,
        [treeId]
    );
    return result.rows;
}

/**
 * One person's "X/Y sourced" counts, by the same rules as the People list's
 * TotalFacts/SourcedFacts and the hero's countTotalFacts/countSourcedFacts:
 * birth, death and each of the person's events, sourced when cited at least once.
 * Null when the person is not in the tree.
 */
export async function getPersonSourcing(id: number, treeId: number): Promise<{ totalFacts: number; sourcedFacts: number } | null> {
    const cited = (table: string, factId: string) =>
        `EXISTS (SELECT 1 FROM "Citation" c WHERE c."TreeId" = $2 AND c."FactTable" = '${table}' AND c."FactId" = ${factId})`;
    const result = await query(
        `SELECT
            (CASE WHEN ${hasBirthFactSql('p')} THEN 1 ELSE 0 END
             + CASE WHEN ${hasDeathFactSql('p')} THEN 1 ELSE 0 END
             + (SELECT COUNT(*) FROM "Events" ev WHERE ev."PersonId" = p."Id" AND ev."TreeId" = $2))::int AS "totalFacts",
            (CASE WHEN ${hasBirthFactSql('p')} AND ${cited('PersonBirth', 'p."Id"')} THEN 1 ELSE 0 END
             + CASE WHEN ${hasDeathFactSql('p')} AND ${cited('PersonDeath', 'p."Id"')} THEN 1 ELSE 0 END
             + (SELECT COUNT(*) FROM "Events" ev
                 WHERE ev."PersonId" = p."Id" AND ev."TreeId" = $2 AND ${cited('Events', 'ev."Id"')}))::int AS "sourcedFacts"
         FROM "People" p WHERE p."Id" = $1 AND p."TreeId" = $2`,
        [id, treeId]
    );
    return (result.rows[0] as { totalFacts: number; sourcedFacts: number } | undefined) ?? null;
}

/**
 * Get a single person by ID (tree-scoped)
 */
export async function getPersonById(id: number, treeId: number): Promise<PersonDisplay | null> {
    const result = await query(
        `SELECT p.*, ${personPlaces('p')}, ${effectiveFirstName('p')} AS "EffectiveFirstName",
                ${primaryNickname('p')} AS "Nickname"
         FROM "People" p WHERE p."Id" = $1 AND p."TreeId" = $2`,
        [id, treeId]
    );
    return (result.rows[0] as PersonDisplay) || null;
}

/**
 * Fetch multiple people by id (scoped to a user) with the display columns,
 * returned as an id→person map. One query regardless of id count — replaces the
 * per-id getPersonById calls that relationship resolution used to make in a loop.
 */
async function getPeopleByIds(ids: number[], treeId: number): Promise<Map<number, PersonDisplay>> {
    const map = new Map<number, PersonDisplay>();
    if (ids.length === 0) return map;
    const result = await query(
        `SELECT p.*, ${personPlaces('p')}, ${effectiveFirstName('p')} AS "EffectiveFirstName",
                ${primaryNickname('p')} AS "Nickname",
                m."Id" AS "PrimaryMediaId", m."FocalX", m."FocalY", m."FocalRadius"
         FROM "People" p
         ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
         WHERE p."Id" = ANY($1) AND p."TreeId" = $2`,
        [ids, treeId]
    );
    for (const row of result.rows as PersonDisplay[]) map.set(row.Id, row);
    return map;
}

/**
 * Fetch the children of many families in one query, grouped by family id. Rows
 * are ordered by birth date within each family, matching the per-family
 * children/sibling queries this replaces.
 */
async function getChildrenByFamilyIds(familyIds: number[], treeId: number): Promise<Map<number, Person[]>> {
    const map = new Map<number, Person[]>();
    if (familyIds.length === 0) return map;
    const result = await query(
        `SELECT p.*, ${personPlaces('p')}, ${effectiveFirstName('p')} AS "EffectiveFirstName",
                ${primaryNickname('p')} AS "Nickname",
                fp."FamiliesAsChildId" AS "FamilyId",
                m."Id" AS "PrimaryMediaId", m."FocalX", m."FocalY", m."FocalRadius"
         FROM "People" p
         INNER JOIN "FamilyPerson" fp ON p."Id" = fp."ChildrenId"
         ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
         WHERE fp."FamiliesAsChildId" = ANY($1) AND p."TreeId" = $2
         ORDER BY fp."FamiliesAsChildId", p."BirthDate"`,
        [familyIds, treeId]
    );
    for (const row of result.rows as (Person & { FamilyId: number })[]) {
        const { FamilyId, ...person } = row;
        const list = map.get(FamilyId);
        if (list) list.push(person as Person);
        else map.set(FamilyId, [person as Person]);
    }
    return map;
}

/**
 * Get a person with all related data (families, events, resolved names).
 *
 * Relationship resolution is batched: after loading the person's own families /
 * events / media in parallel, all related people (spouses + parents) are fetched
 * in a single `= ANY` query and every relevant family's children in one grouped
 * query — instead of the previous per-family/per-person serial round-trip chain.
 * Output shape is identical to the previous implementation.
 */
export async function getPersonWithRelations(id: number, treeId: number): Promise<PersonWithRelations | null> {
    const person = await getPersonById(id, treeId);
    if (!person) return null;

    // The person's own families (as each partner + as a child) and events are
    // independent of each other — run them together. Media is intentionally NOT
    // fetched here: the profile gallery loads it via a separate media.list call
    // (with tagged photos), so the embedded copy was dead weight (audit #9).
    // Every family query is explicitly ORDERed. Without one Postgres gives no
    // guarantee at all, so the relationships pane's row order could change after an
    // unrelated UPDATE, a VACUUM, or a plan change — and the pane's group headings
    // read positionally (#481).
    const [famH, famW, famC, eventsResult] = await Promise.all([
        query(`SELECT f.*, ${familyPlace('f')} FROM "Families" f WHERE (COALESCE(f."Partner1Id", f."HusbandId") = $1) AND f."TreeId" = $2 ORDER BY f."Id"`, [id, treeId]),
        query(`SELECT f.*, ${familyPlace('f')} FROM "Families" f WHERE (COALESCE(f."Partner2Id", f."WifeId") = $1) AND f."TreeId" = $2 ORDER BY f."Id"`, [id, treeId]),
        query(
            // The relationships come along so the UI can NAME an adoptive, foster or
            // step parent rather than drawing a second, identical "Parents" block.
            `SELECT f.*, ${familyPlace('f')}, fp."Partner1Relationship", fp."Partner2Relationship" FROM "Families" f
             INNER JOIN "FamilyPerson" fp ON f."Id" = fp."FamiliesAsChildId"
             WHERE fp."ChildrenId" = $1 AND f."TreeId" = $2
             ORDER BY f."Id"`,
            [id, treeId]
        ),
        query(`SELECT e.*, ${factPlaceTextColumns('events', 'e')} FROM "Events" e WHERE e."PersonId" = $1 AND e."TreeId" = $2 ORDER BY e."Date"`, [id, treeId]),
    ]);

    const familiesAsHusband = famH.rows as Family[];
    const familiesAsWife = famW.rows as Family[];
    const familiesAsChild = famC.rows as (Family & { Partner1Relationship?: string | null; Partner2Relationship?: string | null })[];
    // Attach each event's media (MediaLink OwnerTable='Events') so the life-events
    // timeline can render inline photo strips without an N+1 per-event fetch, and
    // each event's note COUNT (NoteLink OwnerTable='Events') so the same timeline
    // can offer a read affordance on the rows that have notes — again in one query,
    // not one per row. The note text is fetched only when a row is opened.
    const events = await attachNoteCountsToEvents(
        await attachMediaToEvents(eventsResult.rows as GedcomEvent[], treeId),
        treeId,
    );
    // The two halves are fetched separately (this person is Partner1 in some unions
    // and Partner2 in others), so a plain concatenation ordered the pane by WHICH
    // SIDE of each family the person happens to sit on — nothing a reader can see.
    // Sorted chronologically below, once the children are loaded.
    const allFamiliesAsSpouse = [...familiesAsHusband, ...familiesAsWife];

    // Batch-load every related person (spouses + parents) and every relevant
    // family's children in two queries, independent of each other.
    const spouseIds = allFamiliesAsSpouse.map((f) => (f.Partner1Id === id ? f.Partner2Id : f.Partner1Id));
    const parentIds = familiesAsChild.flatMap((f) => [f.Partner1Id, f.Partner2Id]);
    const relatedIds = [...new Set([...spouseIds, ...parentIds].filter((x): x is number => x != null))];
    const familyIds = [...new Set([...allFamiliesAsSpouse, ...familiesAsChild].map((f) => f.Id))];

    const [relatedPeople, childrenByFamily] = await Promise.all([
        getPeopleByIds(relatedIds, treeId),
        getChildrenByFamilyIds(familyIds, treeId),
    ]);

    // Spouse relations: the other partner + that family's children.
    const spouses: SpouseRelation[] = allFamiliesAsSpouse.map((family) => {
        const spouseId = family.Partner1Id === id ? family.Partner2Id : family.Partner1Id;
        const spouse = spouseId != null ? relatedPeople.get(spouseId) ?? null : null;
        return { person: spouse, family, children: childrenByFamily.get(family.Id) ?? [] };
    });

    /**
     * When each union began, best available: the marriage year, else the earliest
     * child's birth year, else unknown. The child fallback matters — a long
     * undated partnership that produced children in the 1990s otherwise sorted
     * BELOW a dated 2017 marriage, which reads as the wrong order to anyone who
     * knows the family.
     */
    const year = (value: string | null | undefined): number | null => {
        const y = parseInt((value ?? '').slice(0, 4), 10);
        return Number.isFinite(y) ? y : null;
    };
    const unionYear = (rel: SpouseRelation): number => {
        const married = year(rel.family.MarriageDate);
        if (married !== null) return married;
        const births = rel.children.map((c) => year(c.BirthDate)).filter((y): y is number => y !== null);
        return births.length > 0 ? Math.min(...births) : Number.POSITIVE_INFINITY;
    };
    // Id breaks the tie, so two equally undated unions still have a fixed order.
    spouses.sort((a, b) => (unionYear(a) - unionYear(b)) || (a.family.Id - b.family.Id));
    // The flat family list follows the same order — the two must not disagree.
    const familiesAsSpouseOrdered = spouses.map((rel) => rel.family);

    // Parent relations: partner 1 = father, partner 2 = mother (matching prior behavior).
    // Each carries its OWN siblings so the UI can attribute them to the right family
    // rather than merging half-siblings from two families into one flat list (#481).
    const parents: ParentRelation[] = familiesAsChild.map((family) => ({
        father: family.Partner1Id != null ? relatedPeople.get(family.Partner1Id) ?? null : null,
        mother: family.Partner2Id != null ? relatedPeople.get(family.Partner2Id) ?? null : null,
        family,
        partner1Relationship: family.Partner1Relationship ?? null,
        partner2Relationship: family.Partner2Relationship ?? null,
        siblings: (childrenByFamily.get(family.Id) ?? []).filter((c) => c.Id !== id),
    }));

    // Flat sibling list, kept for callers that want every sibling regardless of
    // which parent family they come through (RelationshipsSection, tree layout).
    const siblings: Person[] = parents.flatMap((p) => p.siblings);

    return {
        ...person,
        familiesAsSpouse: familiesAsSpouseOrdered,
        familiesAsChild,
        events,
        spouses,
        parents,
        siblings,
    };
}

/**
 * Create a new person
 */
export async function createPerson(data: NewPerson, actingUserId?: number, placePicks: readonly FactPlacePick[] = []): Promise<Audited<Person>> {
    // The birth and death places, matched to the tree's places once, here. A row
    // with no tree (a legacy fixture) has no places to point at.
    const places = data.TreeId != null
        ? await factPlaceRefs({ query }, data.TreeId, data.UserId, { BirthPlace: data.BirthPlace ?? null, DeathPlace: data.DeathPlace ?? null }, placePicks)
        : [];
    const columns = ['"UserId"', '"TreeId"', '"FirstName"', '"LastName"', '"Sex"', '"GedcomId"', '"BirthDate"', '"DeathDate"', '"DeathCause"', '"IsDeceased"', ...places.map(([c]) => c)];
    const values = [data.UserId, data.TreeId ?? null, data.FirstName, data.LastName, data.Sex, data.GedcomId, data.BirthDate, data.DeathDate, data.DeathCause, data.IsDeceased, ...places.map(([, v]) => v)];
    const result = await query(
        `INSERT INTO "People" (${columns.join(', ')}, "UpdatedAt")
         VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')}, CURRENT_TIMESTAMP)
         RETURNING *, ${personPlaces('"People"')}`,
        values
    );

    const newPerson = result.rows[0] as Person;
    if (!newPerson) {
        throw new Error('Failed to create person');
    }

    const auditId = await auditCreate('person', newPerson as unknown as Record<string, unknown>, data.UserId, actingUserId ?? data.UserId);

    return withAuditIds(newPerson, [auditId]);
}

// 'Notes' is deliberately absent: the People."Notes" column was dropped in #524
// (ADR 0010) and people use Note + NoteLink like every other owner. Keep this in
// lockstep with ENTITY_CONFIG.person.allowedFields in audit.ts.
const ALLOWED_PERSON_FIELDS: ReadonlySet<string> = new Set([
    'FirstName', 'LastName', 'Sex', 'GedcomId',
    'BirthDate', 'BirthPlace', 'DeathDate', 'DeathPlace', 'DeathCause', 'IsDeceased',
]);

/**
 * Update an existing person. Authorization = the tree-scoped SELECT (the row
 * must be in the caller's resolved tree) + the user-keyed edit check kept as
 * defense in depth. `actingUserId` defaults to the tree owner for callers that
 * predate the scope split.
 */
export async function updatePerson(id: number, data: Partial<NewPerson>, treeId: number, actingUserId?: number, placePicks: readonly FactPlacePick[] = []): Promise<Audited<Person>> {
    const person = await getPersonById(id, treeId);
    if (!person) {
        // Typed so handleApiError maps a wrong-tree/nonexistent id to 404
        // (a plain Error surfaced as an opaque 500).
        throw new NotFoundError('Person not found');
    }

    const actor = actingUserId ?? person.UserId;
    if (!(await hasEditPermission(person.UserId, actor, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    const fields = Object.keys(data).filter(key => data[key as keyof NewPerson] !== undefined && key !== 'UserId' && key !== 'TreeId');
    for (const field of fields) {
        if (!ALLOWED_PERSON_FIELDS.has(field)) {
            throw new Error(`Invalid field name: ${field}`);
        }
    }

    // A place is matched again only when its text changed or a place was picked
    // for it: an unchanged "Paris" stays on whichever Paris it points at. A pick
    // sent without the text applies to the text the fact shows now.
    const placeTexts: { BirthPlace?: string | null; DeathPlace?: string | null } = {};
    for (const field of ['BirthPlace', 'DeathPlace'] as const) {
        const kind = field === 'BirthPlace' ? 'birth' : 'death';
        const picked = placePicks.some((p) => p.kind === kind);
        if (fields.includes(field) ? data[field] !== person[field] || picked : picked) {
            placeTexts[field] = (fields.includes(field) ? data[field] : person[field]) ?? null;
        }
    }
    const places = await factPlaceRefs({ query }, treeId, person.UserId, placeTexts, placePicks);
    const columns = [
        ...fields.filter((f) => f !== 'BirthPlace' && f !== 'DeathPlace').map((f) => [`"${f}"`, data[f as keyof NewPerson]] as const),
        ...places,
    ];

    if (columns.length === 0) {
        await query(`UPDATE "People" SET "UpdatedAt" = CURRENT_TIMESTAMP WHERE "Id" = $1`, [id]);
    } else {
        const values: unknown[] = columns.map(([, v]) => v);
        const setClauses = columns.map(([c], i) => `${c} = $${i + 1}`);
        values.push(id);
        await query(
            `UPDATE "People" SET ${setClauses.join(', ')}, "UpdatedAt" = CURRENT_TIMESTAMP WHERE "Id" = $${values.length}`,
            values
        );
    }

    const updatedPerson = await getPersonById(id, treeId);
    if (!updatedPerson) {
        throw new Error('Failed to update person');
    }

    const auditId = await auditUpdate(
        'person', person as unknown as Record<string, unknown>, updatedPerson as unknown as Record<string, unknown>, ALLOWED_PERSON_FIELDS, person.UserId, actor,
        undefined, factPlaceRefChanges('people', person as unknown as Record<string, unknown>, updatedPerson as unknown as Record<string, unknown>),
    );

    return withAuditIds(updatedPerson, [auditId]);
}

/**
 * Delete a person (tree-scoped authorizing SELECT + user-keyed edit check)
 */
export async function deletePerson(id: number, treeId: number, actingUserId?: number): Promise<boolean> {
    const person = await getPersonById(id, treeId);
    if (!person) {
        return false;
    }

    const actor = actingUserId ?? person.UserId;
    if (!(await hasEditPermission(person.UserId, actor, treeId))) {
        throw new Error('Permission denied: You do not have edit access to this tree');
    }

    // The snapshot carries the rows the delete cascades away (name variants,
    // face tags, case links) and the person's note and media links, so reverting
    // the entry restores all of them (#788, ED-10). One transaction, so the
    // snapshot matches what was deleted.
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const dependents = await capturePersonDependents(client, id);
        await auditDelete('person', person as unknown as Record<string, unknown>, person.UserId, actor, client, { ...dependents });
        const result = await client.query('DELETE FROM "People" WHERE "Id" = $1', [id]);
        await client.query('COMMIT');
        return (result.rowCount ?? 0) > 0;
    } catch (err) {
        await safeRollback(client);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Search people by name within a specific user's tree, with primary media info
 */
/** "First Last" for a joined person alias, or NULL when absent or nameless. */
const fullNameSql = (alias: string) =>
    `NULLIF(TRIM(COALESCE(${effectiveFirstName(alias)}, '') || ' ' || COALESCE(${alias}."LastName", '')), '')`;

/**
 * `places`: a word may also match the birthplace, as the people list's filter does, under
 * any of the place's names (#1167): "Lviv" finds someone born in "Lemberg". Global
 * search turns it on (#1128); pickers leave it off, because their rows don't show the place
 * that would explain the match.
 */
export async function searchPeople(searchQuery: string, treeId: number, limit = 10, { places = false }: { places?: boolean } = {}): Promise<PersonResult[]> {
    const truncatedQuery = searchQuery.slice(0, 100);
    const tokens = truncatedQuery.trim().split(/\s+/).filter(Boolean);

    const selectClause = `SELECT p."Id", p."FirstName", p."LastName", p."Sex", p."BirthDate", p."DeathDate", ${factPlaceTextSql(factPlaceColumnFor('BirthPlace'), 'p')} AS "BirthPlace",
                ${effectiveFirstName('p')} AS "EffectiveFirstName",
                ${primaryNickname('p')} AS "Nickname",
                m."Id" AS "PrimaryMediaId", m."FocalX", m."FocalY", m."FocalRadius",
                ${fullNameSql('ph')} AS "ParentName1", ${fullNameSql('pw')} AS "ParentName2",
                ${fullNameSql('po')} AS "PartnerName"
         FROM "People" p
         ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
         -- Kin to tell same-named people apart in search (#768, DV-4): the first parent
         -- family's partners, else the first partner.
         LEFT JOIN LATERAL (
             SELECT f."Partner1Id", f."Partner2Id" FROM "Families" f
             INNER JOIN "FamilyPerson" fp ON f."Id" = fp."FamiliesAsChildId"
             WHERE fp."ChildrenId" = p."Id" AND f."TreeId" = p."TreeId"
             ORDER BY f."Id" LIMIT 1
         ) pf ON true
         LEFT JOIN "People" ph ON ph."Id" = pf."Partner1Id"
         LEFT JOIN "People" pw ON pw."Id" = pf."Partner2Id"
         LEFT JOIN LATERAL (
             SELECT CASE WHEN f."Partner1Id" = p."Id" THEN f."Partner2Id" ELSE f."Partner1Id" END AS "OtherId"
               FROM "Families" f
              WHERE (f."Partner1Id" = p."Id" OR f."Partner2Id" = p."Id") AND f."TreeId" = p."TreeId"
              ORDER BY f."Id" LIMIT 1
         ) sp ON true
         LEFT JOIN "People" po ON po."Id" = sp."OtherId"
         WHERE p."TreeId" = $1`;

    // Each token must match the full name OR any of the person's name variants
    // (nickname, maiden, alias, …) so search covers all of a person's names. Both
    // sides are folded by "SearchFold" (accents and ё removed, lower case), so
    // "Etienne" finds Étienne and "Белозерова" finds Белозёрова (#792). A "%" or
    // "_" in the term matches only itself (#849).
    // The LIMIT keeps the first rows by the folded name, not the raw one: PGlite's
    // C collation would otherwise keep a different set than hosted Postgres (#882).
    // The data client puts the kept rows in UI-language order.
    const tokenMatch = (param: number) =>
        `(p."SearchName" LIKE ${likeContains(`"SearchFold"($${param})`)}
          OR EXISTS (SELECT 1 FROM "NameVariant" nv WHERE nv."PersonId" = p."Id" AND nv."SearchName" LIKE ${likeContains(`"SearchFold"($${param})`)})${
          places ? `
          OR EXISTS (SELECT 1 FROM "Places" bp WHERE bp."Id" = p."BirthPlaceId" AND "SearchFold"(bp."Name") LIKE ${likeContains(`"SearchFold"($${param})`)})
          OR EXISTS (SELECT 1 FROM "PlaceName" bn WHERE bn."PlaceId" = p."BirthPlaceId" AND "SearchFold"(bn."Name") LIKE ${likeContains(`"SearchFold"($${param})`)})` : ''})`;

    let result;
    if (tokens.length <= 1) {
        result = await query(
            `${selectClause}
             AND ${tokenMatch(2)}
             ORDER BY "SearchFold"(p."LastName"), "SearchFold"(p."FirstName"), p."Id"
             LIMIT $3`,
            [treeId, tokens[0] ?? '', limit]
        );
    } else {
        // Token-based: every word must match somewhere in first/last/full name or a variant
        const tokenConditions = tokens.map((_, i) => tokenMatch(i + 2));
        const limitParam = tokens.length + 2;
        result = await query(
            `${selectClause}
             AND ${tokenConditions.join(' AND ')}
             ORDER BY "SearchFold"(p."LastName"), "SearchFold"(p."FirstName"), p."Id"
             LIMIT $${limitParam}`,
            [treeId, ...tokens, limit]
        );
    }

    return result.rows as PersonResult[];
}

export interface SpouseSuggestionCandidate {
    Id: number;
    FirstName: string | null;
    LastName: string | null;
    EffectiveFirstName?: string | null;
    Nickname?: string | null;
    Sex: string | null;
    BirthDate: string | null;
    BirthPlace: string | null;
    CreatedAt: string | null;
    UpdatedAt: string | null;
}

/**
 * Find people who have no existing spouse and whose birth year is within ±15 years.
 * Used for spouse suggestion scoring on the add-person form.
 */
export async function suggestSpousesForPerson(treeId: number, birthYear: number): Promise<SpouseSuggestionCandidate[]> {
    const minYear = birthYear - 15;
    const maxYear = birthYear + 15;

    const result = await query(
        `SELECT p."Id", p."FirstName", p."LastName",
                ${effectiveFirstName('p')} AS "EffectiveFirstName",
                ${primaryNickname('p')} AS "Nickname",
                p."Sex", p."BirthDate", ${factPlaceTextSql(factPlaceColumnFor('BirthPlace'), 'p')} AS "BirthPlace", p."CreatedAt", p."UpdatedAt"
         FROM "People" p
         WHERE p."TreeId" = $1
         AND p."Id" NOT IN (
             SELECT COALESCE("Partner1Id", "HusbandId") FROM "Families" WHERE COALESCE("Partner1Id", "HusbandId") IS NOT NULL AND "TreeId" = $1
             UNION
             SELECT COALESCE("Partner2Id", "WifeId") FROM "Families" WHERE COALESCE("Partner2Id", "WifeId") IS NOT NULL AND "TreeId" = $1
         )
         AND SUBSTRING(p."BirthDate" FROM 1 FOR 4) ~ '^[0-9]{4}$'
         AND CAST(SUBSTRING(p."BirthDate" FROM 1 FOR 4) AS INTEGER) BETWEEN $2 AND $3
         ORDER BY ABS(CAST(SUBSTRING(p."BirthDate" FROM 1 FOR 4) AS INTEGER) - $4), p."Id" DESC
         LIMIT 5`,
        [treeId, minYear, maxYear, birthYear]
    );
    return result.rows as SpouseSuggestionCandidate[];
}

/**
 * Get total count of people in a specific tree
 */
export async function getPeopleCount(treeId: number): Promise<number> {
    const result = await query(
        `SELECT COUNT(*) as count FROM "People" WHERE "TreeId" = $1`,
        [treeId]
    );
    return parseInt(result.rows[0].count, 10);
}

/**
 * How many people descend from this one, all generations.
 *
 * The person-detail hero needs this number for one button label. Deriving it from
 * the loaded record is impossible (it carries a single generation) and the
 * descendants tree endpoint returns the whole tree — ~68KB to render one integer.
 *
 * `UNION` (not `UNION ALL`) deduplicates as it recurses, so someone reachable by
 * two paths counts once and a malformed parent/child cycle terminates instead of
 * looping forever.
 */
export async function countDescendantsOfPerson(personId: number, treeId: number): Promise<number> {
    const result = await query(
        `WITH RECURSIVE descendants AS (
             SELECT fp."ChildrenId" AS id
               FROM "Families" f
               JOIN "FamilyPerson" fp ON fp."FamiliesAsChildId" = f."Id"
              WHERE f."TreeId" = $2
                AND (COALESCE(f."Partner1Id", f."HusbandId") = $1
                  OR COALESCE(f."Partner2Id", f."WifeId") = $1)
             UNION
             SELECT fp."ChildrenId"
               FROM descendants d
               JOIN "Families" f
                 ON f."TreeId" = $2
                AND (COALESCE(f."Partner1Id", f."HusbandId") = d.id
                  OR COALESCE(f."Partner2Id", f."WifeId") = d.id)
               JOIN "FamilyPerson" fp ON fp."FamiliesAsChildId" = f."Id"
         )
         SELECT COUNT(*) AS count FROM descendants`,
        [personId, treeId]
    );
    return parseInt(result.rows[0].count, 10);
}

/** Tree-membership check (IDOR guard) — does this person row live in this tree? */
export async function personExistsInTree(personId: number, treeId: number): Promise<boolean> {
    const result = await query(
        'SELECT 1 FROM "People" WHERE "Id" = $1 AND "TreeId" = $2',
        [personId, treeId]
    );
    return (result.rowCount ?? 0) > 0;
}
