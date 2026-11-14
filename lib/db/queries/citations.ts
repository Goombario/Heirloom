import { query } from '@/lib/db/connection';
import { withTransaction } from '@/lib/db/rollback';
import { FACT_TABLES, PERSON_KEYED_FACT_TABLES, type FactTableValue } from '@/lib/db/fact-tables';
import { auditCreate, auditUpdate, auditDelete, withAuditIds, type Audited, type Queryable } from '@/lib/db/queries/audit-capture';
import { integratedFullName } from '@/lib/db/queries/people';
import { primaryMediaIdFor } from '@/lib/db/queries/media-tags';
import { factPlaceColumnFor, factPlaceTextSql, type FactPlaceField } from '@/lib/db/queries/place-links';

/** The text a cited fact's place shows, built from its references (ADR 0037). */
const placeText = (field: FactPlaceField) => factPlaceTextSql(factPlaceColumnFor(field), 'f');

export interface Citation {
    Id: number;
    OwnerId: number;
    TreeId?: number | null;
    FactTable: FactTableValue;
    FactId: number;
    SourceId: number;
    Page: string | null;
    Note: string | null;
    // Slice 3 — GEDCOM SOURCE_CITATION evidence fields (all nullable).
    Quay: string | null;       // QUAY — certainty 0-3
    DataText: string | null;   // DATA.TEXT — transcription from the source
    DataDate: string | null;   // DATA.DATE — when the entry was recorded
    Even: string | null;       // EVEN — event type cited from
    Role: string | null;       // EVEN.ROLE — role in that event
    /** The link to the record this citation points at, exported as `_LINK` (ADR 0025). */
    Url?: string | null;
    /** Sub-lines a GEDCOM import didn't model (an OBJE), levels relative to the SOUR line (#976). */
    RawGedcom?: string | null;
    /** The part of the fact it cites, 'DATE' or 'PLAC', from a GEDCOM import; null cites the whole fact (#990). */
    Part?: string | null;
    CreatedAt: string;
    sourceTitle?: string | null;
    sourceType?: string | null;
    sourceRepo?: string | null;
}

export interface NewCitation {
    OwnerId: number;
    TreeId?: number | null;
    FactTable: FactTableValue;
    FactId: number;
    SourceId: number;
    Page?: string | null;
    Note?: string | null;
    Quay?: string | null;
    DataText?: string | null;
    DataDate?: string | null;
    Even?: string | null;
    Role?: string | null;
    Url?: string | null;
}

/** All citations for a tree (used by GEDCOM export). */
export async function getAllCitations(treeId: number): Promise<Citation[]> {
    const result = await query(
        `SELECT * FROM "Citation" WHERE "TreeId" = $1 ORDER BY "Id" ASC`,
        [treeId]
    );
    return result.rows as Citation[];
}

export async function getCitationsForFact(
    factTable: FactTableValue,
    factId: number,
    treeId: number
): Promise<Citation[]> {
    const result = await query(
        `SELECT c.*, s."Title" AS "sourceTitle", s."Type" AS "sourceType", s."RepositoryName" AS "sourceRepo"
         FROM "Citation" c
         JOIN "Sources" s ON s."Id" = c."SourceId"
         WHERE c."FactTable" = $1 AND c."FactId" = $2 AND c."TreeId" = $3
         ORDER BY c."Id" ASC`,
        [factTable, factId, treeId]
    );
    return result.rows as Citation[];
}

export async function getCitationCountsForPerson(
    personId: number,
    treeId: number
): Promise<number> {
    const result = await query(
        `SELECT COUNT(*)::text AS count
         FROM "Citation"
         WHERE "TreeId" = $1
           AND (
             ("FactTable" = ANY($3) AND "FactId" = $2)
             OR ("FactTable" = 'Events' AND "FactId" IN (
               SELECT "Id" FROM "Events" WHERE "PersonId" = $2 AND "TreeId" = $1
             ))
             OR ("FactTable" = 'NameVariant' AND "FactId" IN (
               SELECT "Id" FROM "NameVariant" WHERE "PersonId" = $2 AND "TreeId" = $1
             ))
           )`,
        [treeId, personId, PERSON_KEYED_FACT_TABLES]
    );
    return parseInt((result.rows[0] as { count: string })?.count ?? '0', 10);
}

export async function getCitationsForPerson(
    personId: number,
    treeId: number
): Promise<{ key: string; citations: Citation[] }[]> {
    const result = await query(
        `SELECT c.*, s."Title" AS "sourceTitle", s."Type" AS "sourceType", s."RepositoryName" AS "sourceRepo"
         FROM "Citation" c
         JOIN "Sources" s ON s."Id" = c."SourceId"
         WHERE c."TreeId" = $1
           AND (
             (c."FactTable" = ANY($3) AND c."FactId" = $2)
             OR (c."FactTable" = 'Events' AND c."FactId" IN (
               SELECT "Id" FROM "Events" WHERE "PersonId" = $2 AND "TreeId" = $1
             ))
             OR (c."FactTable" = 'NameVariant' AND c."FactId" IN (
               SELECT "Id" FROM "NameVariant" WHERE "PersonId" = $2 AND "TreeId" = $1
             ))
           )
         ORDER BY c."Id" ASC`,
        [treeId, personId, PERSON_KEYED_FACT_TABLES]
    );

    const rows = result.rows as Citation[];
    const grouped = new Map<string, Citation[]>();
    for (const row of rows) {
        const key = `${row.FactTable}:${row.FactId}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(row);
    }
    return Array.from(grouped.entries()).map(([key, citations]) => ({ key, citations }));
}

/** Citations the family page shows: its record, its Events rows, and its children's births, deaths and adoptions. */
export async function getCitationsForFamily(
    familyId: number,
    treeId: number
): Promise<{ key: string; citations: Citation[] }[]> {
    const result = await query(
        `SELECT c.*, s."Title" AS "sourceTitle", s."Type" AS "sourceType", s."RepositoryName" AS "sourceRepo"
         FROM "Citation" c
         JOIN "Sources" s ON s."Id" = c."SourceId"
         WHERE c."TreeId" = $1
           AND (
             (c."FactTable" IN ('Families', 'FamilyMarriage') AND c."FactId" = $2)
             OR (c."FactTable" = 'Events' AND c."FactId" IN (
               SELECT "Id" FROM "Events" WHERE "FamilyId" = $2 AND "TreeId" = $1
             ))
             -- …and its children's adoption events (#485).
             OR (c."FactTable" = 'Events' AND c."FactId" IN (
               SELECT "Id" FROM "Events" WHERE "Type" = 'ADOP' AND "TreeId" = $1 AND "PersonId" IN (
                 SELECT "ChildrenId" FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $2
               )
             ))
             -- The family timeline shows its children's births and deaths (#799).
             OR (c."FactTable" IN ('PersonBirth', 'PersonDeath') AND c."FactId" IN (
               SELECT "ChildrenId" FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $2
             ))
           )
         ORDER BY c."Id" ASC`,
        [treeId, familyId]
    );

    const grouped = new Map<string, Citation[]>();
    for (const row of result.rows as Citation[]) {
        const key = `${row.FactTable}:${row.FactId}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(row);
    }
    return Array.from(grouped.entries()).map(([key, citations]) => ({ key, citations }));
}

/** Resolve a comment through its owning case so polymorphic citation writes stay tree-scoped. */
export async function getCaseCommentCitationContext(
    commentId: number,
    treeId: number
): Promise<{ caseId: number; status: string } | null> {
    const result = await query(
        `SELECT cc."CaseId" AS "caseId", ca."Status" AS "status"
         FROM "CaseComments" cc
         JOIN "Cases" ca ON ca."Id" = cc."CaseId"
         WHERE cc."Id" = $1 AND ca."TreeId" = $2`,
        [commentId, treeId]
    );
    return (result.rows[0] as { caseId: number; status: string } | undefined) ?? null;
}

export async function createCitation(data: NewCitation, actingUserId?: number, exec?: Queryable): Promise<Audited<Citation>> {
    const run: Queryable = exec ?? { query: (sql, params) => query(sql, params) };
    const result = await run.query(
        `INSERT INTO "Citation" ("OwnerId", "TreeId", "FactTable", "FactId", "SourceId", "Page", "Note", "Quay", "DataText", "DataDate", "Even", "Role", "Url")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
            data.OwnerId, data.TreeId ?? null, data.FactTable, data.FactId, data.SourceId, data.Page ?? null, data.Note ?? null,
            data.Quay ?? null, data.DataText ?? null, data.DataDate ?? null, data.Even ?? null, data.Role ?? null, data.Url ?? null,
        ]
    );
    const created = result.rows[0] as Citation;
    const auditId = await auditCreate('citation', created as unknown as Record<string, unknown>, data.OwnerId, actingUserId ?? data.OwnerId, exec);
    return withAuditIds(created, [auditId]);
}

/**
 * The tree-scoped table a cited fact's FactId lives in. Person-keyed facts point
 * at the person. Cases and CaseComments are absent: their writes are validated
 * through the case, with its closed-status check.
 */
export const CITED_RECORD_TABLE: Partial<Record<FactTableValue, string>> = {
    [FACT_TABLES.PEOPLE]: '"People"',
    [FACT_TABLES.PERSON_BIRTH]: '"People"',
    [FACT_TABLES.PERSON_DEATH]: '"People"',
    [FACT_TABLES.PERSON_NAME]: '"People"',
    [FACT_TABLES.FAMILIES]: '"Families"',
    [FACT_TABLES.FAMILY_MARRIAGE]: '"Families"',
    [FACT_TABLES.EVENTS]: '"Events"',
    [FACT_TABLES.NAME_VARIANT]: '"NameVariant"',
};

/** Whether a source belongs to this tree (the IDOR guard on every citation write). */
export async function sourceInTree(sourceId: number, treeId: number, exec?: Queryable): Promise<boolean> {
    const run: Queryable = exec ?? { query: (sql, params) => query(sql, params) };
    const result = await run.query(`SELECT 1 FROM "Sources" WHERE "Id" = $1 AND "TreeId" = $2`, [sourceId, treeId]);
    return result.rows.length > 0;
}

/**
 * Of `factIds`, the ones whose record lives in this tree. A bulk cite (#799)
 * checks every fact before it writes any, so one foreign id fails the request.
 */
export async function factIdsInTree(factTable: FactTableValue, factIds: number[], treeId: number, exec?: Queryable): Promise<Set<number>> {
    const table = CITED_RECORD_TABLE[factTable];
    // A fractional or out-of-range id names no row; filtering it keeps the cast from throwing.
    const ids = factIds.filter(Number.isSafeInteger);
    if (!table || ids.length === 0) return new Set();
    const run: Queryable = exec ?? { query: (sql, params) => query(sql, params) };
    const result = await run.query(
        `SELECT "Id" FROM ${table} WHERE "TreeId" = $1 AND "Id" = ANY($2::bigint[])`,
        [treeId, ids]
    );
    return new Set((result.rows as { Id: number }[]).map(row => Number(row.Id)));
}

/** Citation fields the editor may change; must stay in sync with `ENTITY_CONFIG.citation` in audit.ts. */
const ALLOWED_CITATION_FIELDS: ReadonlySet<string> = new Set(['Page', 'Quay', 'DataText', 'Url']);

/**
 * Update a citation's editable fields (Page / Quay / DataText / Url). Returns null if not found in this tree.
 * An omitted Url keeps the stored link, so a caller that predates it can't clear it.
 */
export async function updateCitation(
    id: number,
    treeId: number,
    patch: { Page?: string | null; Quay?: string | null; DataText?: string | null; Url?: string | null },
    actingUserId?: number
): Promise<Audited<Citation> | null> {
    // The change and its audit entry land together (#51, L-14).
    return withTransaction(async (client) => {
        const before = await client.query(
            `SELECT * FROM "Citation" WHERE "Id" = $1 AND "TreeId" = $2`,
            [id, treeId]
        );
        const beforeRow = before.rows[0] as Citation | undefined;
        if (!beforeRow) return null;

        const result = await client.query(
            `UPDATE "Citation"
             SET "Page" = $3, "Quay" = $4, "DataText" = $5, "Url" = $6
             WHERE "Id" = $1 AND "TreeId" = $2
             RETURNING *`,
            [id, treeId, patch.Page ?? null, patch.Quay ?? null, patch.DataText ?? null, patch.Url === undefined ? beforeRow.Url ?? null : patch.Url]
        );
        const after = result.rows[0] as Citation;
        const auditId = await auditUpdate('citation', beforeRow as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, ALLOWED_CITATION_FIELDS, beforeRow.OwnerId, actingUserId ?? beforeRow.OwnerId, client);
        return withAuditIds(after, [auditId]);
    });
}

export async function deleteCitation(id: number, treeId: number, actingUserId?: number): Promise<Audited<{ deleted: boolean }>> {
    return withTransaction(async (client) => {
        const before = await client.query(
            `SELECT * FROM "Citation" WHERE "Id" = $1 AND "TreeId" = $2`,
            [id, treeId]
        );
        const beforeRow = before.rows[0] as Citation | undefined;
        if (!beforeRow) return { deleted: false, auditIds: [] };

        const result = await client.query(
            `DELETE FROM "Citation" WHERE "Id" = $1 AND "TreeId" = $2`,
            [id, treeId]
        );
        const deleted = (result.rowCount ?? 0) > 0;
        const auditId = deleted
            ? await auditDelete('citation', beforeRow as unknown as Record<string, unknown>, beforeRow.OwnerId, actingUserId ?? beforeRow.OwnerId, client)
            : null;
        return withAuditIds({ deleted }, [auditId]);
    });
}

/**
 * Cited-by row for the library detail page. Returns *raw* variable parts (name,
 * event type, case title) so the client picks the locale-correct label via a
 * `t()` key derived from `factTable`. No user-visible text is built in SQL.
 */
export interface CitedByRow {
    citationId: number;
    factTable: FactTableValue;
    factId: number;
    /** The subject person's "First Last": the fact's person, or the person who
     *  owns the event or name variant. Null for family and case rows. */
    personName: string | null;
    /** Event type code when factTable='Events'; null otherwise. */
    eventType: string | null;
    /** Event date when factTable='Events'; null otherwise. */
    eventDate: string | null;
    /** NameVariant type when factTable='NameVariant'; null otherwise. */
    variantType: string | null;
    /** NameVariant name when factTable='NameVariant'; null otherwise. */
    variantName: string | null;
    /** Case title when factTable='Cases'; null otherwise. */
    caseTitle: string | null;
    personId: number | null;
    caseId: number | null;
    /** Sex of the person this row is about — drives the avatar disc colour. */
    personSex: string | null;
    /** That person's primary photo, for the avatar. Null when they have none. */
    personMediaId: number | null;
    /** The subject family: the fact itself when factTable='Families', or the
     *  family that owns a family event. Null otherwise. */
    familyId: number | null;
    /** Partner display names/photos for a family row, in Partner1, Partner2 order.
     *  A family with one recorded partner leaves the second set null. */
    familyPartner1Name: string | null;
    familyPartner1Sex: string | null;
    familyPartner1MediaId: number | null;
    familyPartner2Name: string | null;
    familyPartner2Sex: string | null;
    familyPartner2MediaId: number | null;
    /** The citation's own page or line, certainty (QUAY 0-3) and transcription. */
    page: string | null;
    quay: string | null;
    dataText: string | null;
    /** The cited fact's date and place: a birth, death, marriage (the family fact
     *  too) or event. Null for name, person, case and name-variant rows. */
    factDate: string | null;
    factPlace: string | null;
    /** `"SortableYear"(factDate)`, the key the rows are ordered by (#911). */
    sortableYear: number | null;
}

/**
 * Name / sex / photo of one side of a family, given the partner-id columns.
 *
 * COALESCE over the legacy Husband/Wife columns like every other partner read in
 * the codebase: the Phase-9 rename only backfilled families where BOTH new
 * columns were null, so a partially-migrated row still keeps a partner in the
 * legacy column, and reading the new column alone renders that family as "?".
 */
function familyPartnerCols(familyIdExpr: string, partnerCol: string, legacyCol: string, label: string): string {
    const partnerIdExpr = `(SELECT COALESCE(f."${partnerCol}", f."${legacyCol}") FROM "Families" f WHERE f."Id" = ${familyIdExpr})`;
    return `
           (SELECT ${integratedFullName('p')} FROM "People" p WHERE p."Id" = ${partnerIdExpr}) AS "${label}Name",
           (SELECT p."Sex" FROM "People" p WHERE p."Id" = ${partnerIdExpr}) AS "${label}Sex",
           ${primaryMediaIdFor(partnerIdExpr, 'c."TreeId"')} AS "${label}MediaId"`;
}

export async function getCitedByForSource(sourceId: number, treeId: number): Promise<CitedByRow[]> {
    // The person this row is about: the fact's own person for person-keyed rows,
    // the owning person for an event or a name variant. Reused for the name, the
    // avatar colour and the avatar photo so all three agree.
    const subjectPersonId = `CASE
             WHEN c."FactTable" IN ('People', 'PersonName', 'PersonBirth', 'PersonDeath') THEN c."FactId"
             WHEN c."FactTable" = 'Events' THEN (SELECT "PersonId" FROM "Events" WHERE "Id" = c."FactId")
             WHEN c."FactTable" = 'NameVariant' THEN (SELECT "PersonId" FROM "NameVariant" WHERE "Id" = c."FactId")
             ELSE NULL
           END`;
    // The family a family fact or family event is about (#755).
    const subjectFamilyId = `CASE
             WHEN c."FactTable" IN ('Families', 'FamilyMarriage') THEN c."FactId"
             WHEN c."FactTable" = 'Events' THEN (SELECT "FamilyId" FROM "Events" WHERE "Id" = c."FactId")
             ELSE NULL
           END`;

    // The cited fact's own date: the rows are ordered by it (#911).
    const factDate = `CASE c."FactTable"
             WHEN 'PersonBirth' THEN (SELECT "BirthDate" FROM "People" WHERE "Id" = c."FactId")
             WHEN 'PersonDeath' THEN (SELECT "DeathDate" FROM "People" WHERE "Id" = c."FactId")
             WHEN 'Families' THEN (SELECT "MarriageDate" FROM "Families" WHERE "Id" = c."FactId")
             WHEN 'FamilyMarriage' THEN (SELECT "MarriageDate" FROM "Families" WHERE "Id" = c."FactId")
             WHEN 'Events' THEN (SELECT "Date" FROM "Events" WHERE "Id" = c."FactId")
           END`;

    const result = await query(
        `SELECT
           c."Id" AS "citationId",
           c."FactTable" AS "factTable",
           c."FactId" AS "factId",
           (SELECT ${integratedFullName('p')} FROM "People" p WHERE p."Id" = ${subjectPersonId}) AS "personName",
           CASE WHEN c."FactTable" = 'Events' THEN (SELECT "Type" FROM "Events" WHERE "Id" = c."FactId") ELSE NULL END AS "eventType",
           CASE WHEN c."FactTable" = 'Events' THEN (SELECT "Date" FROM "Events" WHERE "Id" = c."FactId") ELSE NULL END AS "eventDate",
           CASE WHEN c."FactTable" = 'NameVariant' THEN (SELECT "Type" FROM "NameVariant" WHERE "Id" = c."FactId") ELSE NULL END AS "variantType",
           CASE WHEN c."FactTable" = 'NameVariant' THEN (SELECT "Name" FROM "NameVariant" WHERE "Id" = c."FactId") ELSE NULL END AS "variantName",
           CASE c."FactTable"
             WHEN 'Cases' THEN (SELECT "Title" FROM "Cases" WHERE "Id" = c."FactId")
             -- A journal entry's citation belongs to the entry's case.
             WHEN 'CaseComments' THEN (SELECT cs."Title" FROM "CaseComments" cc JOIN "Cases" cs ON cs."Id" = cc."CaseId" WHERE cc."Id" = c."FactId")
             -- So does a finding's (#58).
             WHEN 'CaseFindings' THEN (SELECT cs."Title" FROM "CaseFindings" cf JOIN "Cases" cs ON cs."Id" = cf."CaseId" WHERE cf."Id" = c."FactId")
           END AS "caseTitle",
           ${subjectPersonId} AS "personId",
           CASE c."FactTable"
             WHEN 'Cases' THEN c."FactId"
             WHEN 'CaseComments' THEN (SELECT "CaseId" FROM "CaseComments" WHERE "Id" = c."FactId")
             WHEN 'CaseFindings' THEN (SELECT "CaseId" FROM "CaseFindings" WHERE "Id" = c."FactId")
           END AS "caseId",
           (SELECT p."Sex" FROM "People" p WHERE p."Id" = ${subjectPersonId}) AS "personSex",
           ${primaryMediaIdFor(`(${subjectPersonId})`, 'c."TreeId"')} AS "personMediaId",
           ${subjectFamilyId} AS "familyId",
           ${familyPartnerCols(`(${subjectFamilyId})`, 'Partner1Id', 'HusbandId', 'familyPartner1')},
           ${familyPartnerCols(`(${subjectFamilyId})`, 'Partner2Id', 'WifeId', 'familyPartner2')},
           c."Page" AS "page",
           c."Quay" AS "quay",
           c."DataText" AS "dataText",
           ${factDate} AS "factDate",
           "SortableYear"(${factDate}) AS "sortableYear",
           CASE c."FactTable"
             WHEN 'PersonBirth' THEN (SELECT ${placeText('BirthPlace')} FROM "People" f WHERE f."Id" = c."FactId")
             WHEN 'PersonDeath' THEN (SELECT ${placeText('DeathPlace')} FROM "People" f WHERE f."Id" = c."FactId")
             WHEN 'Families' THEN (SELECT ${placeText('MarriagePlace')} FROM "Families" f WHERE f."Id" = c."FactId")
             WHEN 'FamilyMarriage' THEN (SELECT ${placeText('MarriagePlace')} FROM "Families" f WHERE f."Id" = c."FactId")
             WHEN 'Events' THEN (SELECT ${placeText('Place')} FROM "Events" f WHERE f."Id" = c."FactId")
           END AS "factPlace"
         FROM "Citation" c
         WHERE c."SourceId" = $1 AND c."TreeId" = $2
         -- By the fact's year, undated last, then by who it is about (#911). The
         -- browser groups these by fact type; each group keeps this order.
         ORDER BY "sortableYear" NULLS LAST, "personName" NULLS LAST, c."FactTable", c."FactId"`,
        [sourceId, treeId]
    );
    return result.rows as CitedByRow[];
}
