import { FACT_TABLES, PERSON_KEYED_FACT_TABLES } from '@/lib/db/fact-tables';

/**
 * SQL predicates for FK-less rows whose owner still exists (#881).
 *
 * A person or family delete leaves its events, citations and child links in
 * place so an audit revert can bring the owner back with its original id
 * (`person-dependents.ts`). Those stranded rows are kept forever, so every count
 * shown to the user goes through these predicates: it drops on a delete and
 * comes back on the revert. Destructive paths (overwrite import, rename) and the
 * invariant sweep still see every row.
 *
 * Each takes the alias of the row being tested and returns a boolean expression.
 */

/** An event whose person or family exists. An event with neither id isn't stranded, so it counts. */
export function liveEventSql(alias: string): string {
    return `((${alias}."PersonId" IS NULL AND ${alias}."FamilyId" IS NULL)
        OR EXISTS (SELECT 1 FROM "People" lo WHERE lo."Id" = ${alias}."PersonId")
        OR EXISTS (SELECT 1 FROM "Families" lo WHERE lo."Id" = ${alias}."FamilyId"))`;
}

const quoted = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

/** A citation whose fact exists, and for an event citation, whose event's owner exists too. Unknown fact tables count. */
export function liveCitationSql(alias: string): string {
    const fact = `${alias}."FactId"`;
    return `(CASE
        WHEN ${alias}."FactTable" IN (${quoted(PERSON_KEYED_FACT_TABLES)})
            THEN EXISTS (SELECT 1 FROM "People" lc WHERE lc."Id" = ${fact})
        WHEN ${alias}."FactTable" = '${FACT_TABLES.EVENTS}'
            THEN EXISTS (SELECT 1 FROM "Events" lce WHERE lce."Id" = ${fact} AND ${liveEventSql('lce')})
        WHEN ${alias}."FactTable" IN ('${FACT_TABLES.FAMILIES}', '${FACT_TABLES.FAMILY_MARRIAGE}')
            THEN EXISTS (SELECT 1 FROM "Families" lc WHERE lc."Id" = ${fact})
        WHEN ${alias}."FactTable" = '${FACT_TABLES.NAME_VARIANT}'
            THEN EXISTS (SELECT 1 FROM "NameVariant" lc WHERE lc."Id" = ${fact})
        WHEN ${alias}."FactTable" = '${FACT_TABLES.CASES}'
            THEN EXISTS (SELECT 1 FROM "Cases" lc WHERE lc."Id" = ${fact})
        WHEN ${alias}."FactTable" = '${FACT_TABLES.CASE_COMMENTS}'
            THEN EXISTS (SELECT 1 FROM "CaseComments" lc WHERE lc."Id" = ${fact})
        ELSE TRUE
    END)`;
}

/** A `FamilyPerson` child link whose child exists (the family side is the caller's join). */
export function liveChildLinkSql(alias: string): string {
    return `EXISTS (SELECT 1 FROM "People" lk WHERE lk."Id" = ${alias}."ChildrenId")`;
}
