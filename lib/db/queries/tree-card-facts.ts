import { query } from '@/lib/db/connection';
import { factPlaceColumnFor, factPlaceTextSql } from '@/lib/db/queries/place-links';

/** One person's facts for the tree card's line under the name (#12). */
export interface TreeCardFactRow {
    PersonId: number;
    /** The latest occupation event's value. */
    Occupation: string | null;
    /** The place of the latest residence event that has one. */
    Residence: string | null;
    BirthPlace: string | null;
}

/**
 * The facts a tree card can show under the name, for every person in a tree who
 * has at least one. "Latest" is by the event's year, then the newest record; an
 * undated event counts only when no dated one has a value.
 */
export async function getTreeCardFacts(treeId: number): Promise<TreeCardFactRow[]> {
    const latest = `ORDER BY "SortableYear"(e."Date") DESC NULLS LAST, e."Id" DESC LIMIT 1`;
    const result = await query(
        `SELECT * FROM (
           SELECT p."Id" AS "PersonId",
                  (SELECT btrim(e."Description") FROM "Events" e
                    WHERE e."PersonId" = p."Id" AND e."TreeId" = p."TreeId" AND e."Type" = 'OCCU'
                      AND btrim(COALESCE(e."Description", '')) <> ''
                    ${latest}) AS "Occupation",
                  (SELECT ${factPlaceTextSql(factPlaceColumnFor('Place'), 'e')} FROM "Events" e
                    WHERE e."PersonId" = p."Id" AND e."TreeId" = p."TreeId" AND e."Type" = 'RESI'
                      AND e."PlaceId" IS NOT NULL
                    ${latest}) AS "Residence",
                  ${factPlaceTextSql(factPlaceColumnFor('BirthPlace'), 'p')} AS "BirthPlace"
             FROM "People" p
            WHERE p."TreeId" = $1
         ) f
         WHERE f."Occupation" IS NOT NULL OR f."Residence" IS NOT NULL OR f."BirthPlace" IS NOT NULL`,
        [treeId]
    );
    return result.rows as TreeCardFactRow[];
}
